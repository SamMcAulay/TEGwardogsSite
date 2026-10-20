import { describe, expect, test } from 'vitest';
import { teamKillers } from './teamkills';
import type { KillRow } from './views';

const row = (eventId: string, ts: number, killer: string | null, victim: string, serverName = 'EU#1'): KillRow => ({
  eventId,
  serverId: serverName,
  serverName,
  ts,
  cursor: '',
  killerSteamId: killer,
  killerName: killer && `name-${killer}`,
  victimSteamId: victim,
  victimName: `name-${victim}`,
  cause: null,
  distance: null,
  headshot: 0,
  suicide: 0,
  teamkill: 1,
  tags: '',
});

describe('teamKillers', () => {
  test('adds up per killer, worst first, counting different victims and servers', () => {
    const out = teamKillers([
      row('1', 50, 'A', 'X', 'EU#2'),
      row('2', 40, 'B', 'X'),
      row('3', 30, 'A', 'Y'),
      row('4', 20, 'A', 'X'),
    ]);
    expect(out.map((t) => [t.steamId, t.count, t.victims, t.servers, t.lastAt])).toEqual([
      ['A', 3, 2, ['EU#2', 'EU#1'], 50],
      ['B', 1, 1, ['EU#1'], 40],
    ]);
    expect(out[0].kills.map((k) => k.eventId)).toEqual(['1', '3', '4']);
    expect(out[0].name).toBe('name-A');
  });

  test('a tie goes to the more recent; no-killer and self kills are left out', () => {
    const out = teamKillers([row('1', 10, 'A', 'X'), row('2', 20, 'B', 'X'), row('3', 30, null, 'X'), row('4', 40, 'C', 'C')]);
    expect(out.map((t) => t.steamId)).toEqual(['B', 'A']);
  });
});
