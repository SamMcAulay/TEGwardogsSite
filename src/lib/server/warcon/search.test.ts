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
    expect(parseBoardCsv(CSV)[1]).toEqual({ steamId: '76561198000000002', name: 'owlbear', minutes: 300, lastSeen: null });
  });

  test('CSV with extra columns removes private data', () => {
    const csvWithExtra = [
      'rank,steam_id,name,playtime_min,notes,watched,last_seen',
      '1,76561198000000001,TestPlayer,600,PRIVATE-NOTE,true,2026-10-01T00:00:00.000Z',
    ].join('\n');

    const result = parseBoardCsv(csvWithExtra);
    expect(result).toHaveLength(1);
    const hit = result[0];
    expect(Object.keys(hit).sort()).toEqual(['lastSeen', 'minutes', 'name', 'steamId']);
    const serialized = JSON.stringify(hit);
    expect(serialized).not.toContain('PRIVATE-NOTE');
    expect(serialized).not.toContain('watched');
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

  test('a query under two characters returns nothing', async () => {
    const { idx } = index();
    expect(await idx.search('o')).toEqual([]);
  });
});
