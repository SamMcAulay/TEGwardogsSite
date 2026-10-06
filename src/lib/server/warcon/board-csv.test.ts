import { describe, expect, test } from 'vitest';
import { parseBoardExport } from './board-csv';

const HEAD =
  'rank,steam_id,name,playtime_min,seeded_min,kills,deaths,kd,kills_per_hour,headshots,team_kills,suicides,vehicle_kills,kill_streak,death_streak,matches,wins,losses,draws,win_pct,cash,last_seen';

describe('parseBoardExport', () => {
  test('reads every board field the site shows, in Warcon order', () => {
    const csv = [
      HEAD,
      '1,76561198000000001,"Night, Owl",900,0,120,40,3,8,30,1,0,2,9,4,12,8,3,1,66.7,5000,2026-10-01T00:00:00.000Z',
      '2,76561198000000002,owl,300,0,90,30,3,18,10,0,0,0,5,2,4,1,3,0,25,0,',
    ].join('\n');
    expect(parseBoardExport(csv)).toEqual([
      { rank: 1, steamId: '76561198000000001', name: 'Night, Owl', minutes: 900, kills: 120, deaths: 40, headshots: 30, matches: 12, wins: 8, losses: 3, draws: 1, cash: 5000, lastSeen: '2026-10-01T00:00:00.000Z' },
      { rank: 2, steamId: '76561198000000002', name: 'owl', minutes: 300, kills: 90, deaths: 30, headshots: 10, matches: 4, wins: 1, losses: 3, draws: 0, cash: 0, lastSeen: null },
    ]);
  });

  test('extra columns never reach a row', () => {
    const csv = [`${HEAD},notes,watched`, `1,76561198000000001,A,60,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,,PRIVATE-NOTE,true`].join('\n');
    const out = JSON.stringify(parseBoardExport(csv));
    expect(out).not.toContain('PRIVATE-NOTE');
    expect(out).not.toContain('watched');
  });

  test('a changed format throws (a missing column) instead of showing a wrong board', () => {
    expect(() => parseBoardExport('rank,steam_id,name\n1,76561198000000001,A')).toThrow(/board export has no \w+ column/);
  });

  test('rows without a valid SteamID are skipped; an empty board is empty', () => {
    expect(parseBoardExport(`${HEAD}\n1,bad,A,60,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,`)).toEqual([]);
    expect(parseBoardExport(HEAD)).toEqual([]);
  });
});
