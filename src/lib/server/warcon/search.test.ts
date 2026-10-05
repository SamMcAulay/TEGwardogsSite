import { describe, expect, test, vi } from 'vitest';
import { parseBoardCsv, SearchIndex } from './search';

const CSV = [
  'rank,steam_id,name,playtime_min,seeded_min,kills,deaths,kd,kills_per_hour,headshots,team_kills,suicides,vehicle_kills,kill_streak,death_streak,matches,wins,losses,draws,win_pct,cash,last_seen',
  '1,76561198000000001,"Night, Owl",900,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,2026-10-01T00:00:00.000Z',
  '2,76561198000000002,owlbear,300,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,',
  '3,76561198000000003,"Say ""hi""",100,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,',
].join('\n');

describe('parseBoardCsv', () => {
  test('reads quoted names, commas and doubled quotes', () => {
    expect(parseBoardCsv(CSV).map((h) => h.name)).toEqual(['Night, Owl', 'owlbear', 'Say "hi"']);
    expect(parseBoardCsv(CSV)[1]).toEqual({ steamId: '76561198000000002', name: 'owlbear', minutes: 300, kills: 1, lastSeen: null });
  });

  test('CSV with extra columns removes private data', () => {
    const csvWithExtra = [
      'rank,steam_id,name,playtime_min,notes,watched,last_seen',
      '1,76561198000000001,TestPlayer,600,PRIVATE-NOTE,true,2026-10-01T00:00:00.000Z',
    ].join('\n');

    const result = parseBoardCsv(csvWithExtra);
    expect(result).toHaveLength(1);
    const hit = result[0];
    expect(Object.keys(hit).sort()).toEqual(['kills', 'lastSeen', 'minutes', 'name', 'steamId']);
    const serialized = JSON.stringify(hit);
    expect(serialized).not.toContain('PRIVATE-NOTE');
    expect(serialized).not.toContain('watched');
  });

  test('throws when the steam_id or name column is missing', () => {
    expect(() => parseBoardCsv('rank,name,playtime_min\n1,A,5')).toThrow(/steam_id/);
    expect(() => parseBoardCsv('rank,steam_id,playtime_min\n1,76561198000000001,5')).toThrow(/name/);
  });

  test('skips rows whose steam id is not 17 digits', () => {
    const csv = ['steam_id,name,playtime_min', '76561198000000001,Good,5', '1234,Short,5', ',Blank,5', '7656119800000000x,Bad,5'].join('\n');
    expect(parseBoardCsv(csv).map((h) => h.name)).toEqual(['Good']);
  });
});

describe('SearchIndex', () => {
  const index = (load = vi.fn(async () => CSV), now = () => 0) => ({ load, idx: new SearchIndex({ load, now }) });

  test('matches part of a name, case-insensitive, most playtime first', async () => {
    const { idx } = index();
    expect((await idx.search('OWL')) as { name: string }[]).toMatchObject([{ name: 'Night, Owl' }, { name: 'owlbear' }]);
  });

  test('a SteamID matches exactly', async () => {
    const { idx } = index();
    expect(await idx.search('76561198000000003')).toMatchObject([{ name: 'Say "hi"' }]);
  });

  test('says warming while the first load is failing', async () => {
    const { idx } = index(vi.fn(async () => Promise.reject(new Error('down'))));
    expect(await idx.search('owl')).toBe('warming');
  });

  test('refreshes after 15 minutes, keeps the old list if the refresh fails', async () => {
    let t = 0;
    const load = vi.fn(async () => CSV);
    const idx = new SearchIndex({ load, now: () => t });
    await idx.search('owl');
    t = 15 * 60_000 + 1;
    load.mockRejectedValueOnce(new Error('down'));
    expect(await idx.search('owl')).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('after a failed refresh, waits 60 s before trying again', async () => {
    let t = 0;
    const load = vi.fn(async () => CSV);
    const idx = new SearchIndex({ load, now: () => t });
    await idx.search('owl');
    t = 15 * 60_000 + 1;
    load.mockRejectedValue(new Error('down'));
    expect(await idx.search('owl')).toHaveLength(2);
    t += 30_000;
    expect(await idx.search('owl')).toHaveLength(2);
    t += 29_000;
    expect(await idx.search('owl')).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(2);
    t += 2_000;
    await idx.search('owl');
    expect(load).toHaveBeenCalledTimes(3);
  });

  test('a failing first load says warming without retrying for 60 s', async () => {
    let t = 0;
    const load = vi.fn(async () => Promise.reject(new Error('down')));
    const idx = new SearchIndex({ load, now: () => t });
    expect(await idx.search('owl')).toBe('warming');
    t += 59_000;
    expect(await idx.search('owl')).toBe('warming');
    expect(load).toHaveBeenCalledTimes(1);
    t += 2_000;
    expect(await idx.search('owl')).toBe('warming');
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('a query under two characters returns nothing', async () => {
    const { idx } = index();
    expect(await idx.search('o')).toEqual([]);
  });
});

describe('snapshot', () => {
  test('returns every player with kills, loading the export when needed', async () => {
    const idx = new SearchIndex({ load: async () => CSV });
    const all = await idx.snapshot();
    expect(all !== 'warming' && all.map((h) => [h.steamId, h.kills])).toEqual([
      ['76561198000000001', 1],
      ['76561198000000002', 1],
      ['76561198000000003', 1],
    ]);
  });

  test('says warming before the first export has loaded', async () => {
    const idx = new SearchIndex({ load: async () => Promise.reject(new Error('down')) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await idx.snapshot()).toBe('warming');
  });
});
