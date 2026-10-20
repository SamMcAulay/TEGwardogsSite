import { describe, expect, test } from 'vitest';
import { clanValue, groupClans, MIN_CLAN_SIZE, type ClanMemberRow } from './clans';

const row = (name: string, o: Partial<ClanMemberRow> = {}): ClanMemberRow => ({
  steamId: name,
  name,
  minutes: 60,
  kills: 10,
  deaths: 5,
  headshots: 1,
  matches: 2,
  wins: 1,
  losses: 1,
  draws: 0,
  lastSeen: '2026-10-20T10:00:00Z',
  ...o,
});

describe('groupClans', () => {
  test('groups by tag whichever way it is written, adds up stats, members by kills', () => {
    const [teg] = groupClans([
      row('[TEG] A', { kills: 5 }),
      row('B [teg]', { kills: 50, lastSeen: '2026-10-20T11:00:00Z' }),
      row('(TEG) C', { kills: 20, lastSeen: null }),
      row('Loner'),
    ]);
    expect(teg.tag).toBe('TEG');
    expect(teg.members.map((m) => m.name)).toEqual(['B [teg]', '(TEG) C', '[TEG] A']);
    expect([teg.kills, teg.deaths, teg.minutes, teg.wins]).toEqual([75, 15, 180, 3]);
    expect(teg.lastSeen).toBe(Date.parse('2026-10-20T11:00:00Z') / 1000);
  });

  test(`a tag needs ${MIN_CLAN_SIZE} players`, () => {
    expect(groupClans([row('[AB] 1'), row('[AB] 2')])).toEqual([]);
  });

  test('sorted by the chosen stat, ties by kills', () => {
    const rows = [
      ...[1, 2, 3].map((i) => row(`[BIG] ${i}`, { kills: 100, deaths: 100 })),
      ...[1, 2, 3, 4].map((i) => row(`[SHARP] ${i}`, { kills: 50, deaths: 5 })),
    ];
    expect(groupClans(rows, 'kills').map((c) => c.tag)).toEqual(['BIG', 'SHARP']);
    expect(groupClans(rows, 'kd').map((c) => c.tag)).toEqual(['SHARP', 'BIG']);
    expect(groupClans(rows, 'members').map((c) => c.tag)).toEqual(['SHARP', 'BIG']);
    const [sharp] = groupClans(rows, 'kd');
    expect(clanValue('perHour', sharp)).toBe(50);
    expect(clanValue('winRate', sharp)).toBe(0.5);
  });
});
