import { describe, expect, test } from 'vitest';
import { HIDDEN_NAME, maskAward, maskKill, maskLine, maskLive, recentRound, RECENT_S, withoutPresence } from './presence';
import type { KillRow } from './views';

const H = '76561198000000009';
const OTHER = '76561198000000001';
const hidden = new Set([H]);
const NOW = 1_800_000_000;

const kill = (ts: number, killer = H, victim = OTHER): KillRow => ({
  eventId: 'e', serverId: 's', serverName: 'EU#1', ts, cursor: '', killerSteamId: killer, killerName: 'Hid', victimSteamId: victim, victimName: 'Vic',
  cause: null, distance: null, headshot: 0, suicide: 0, teamkill: 0, tags: '',
});

describe('presence masking', () => {
  test('live rows lose name and link', () => {
    expect(maskLive({ name: 'Hid', steamId: H, faction: 'A', kills: 1, deaths: 0, cash: 0 }, hidden)).toMatchObject({ name: HIDDEN_NAME, steamId: '' });
    expect(maskLive({ name: 'Bob', steamId: OTHER, faction: 'A', kills: 1, deaths: 0, cash: 0 }, hidden).name).toBe('Bob');
  });

  test('recent kills are masked on either side; older ones are history', () => {
    expect(maskKill(kill(NOW - 60), hidden, NOW)).toMatchObject({ killerSteamId: null, killerName: HIDDEN_NAME, victimSteamId: OTHER, victimName: 'Vic' });
    expect(maskKill(kill(NOW - 60, OTHER, H), hidden, NOW)).toMatchObject({ killerName: 'Hid', victimSteamId: null, victimName: HIDDEN_NAME });
    expect(maskKill(kill(NOW - RECENT_S - 1), hidden, NOW).killerName).toBe('Hid');
  });

  test('a round is recent while it runs and for three hours after', () => {
    expect(recentRound(null, NOW)).toBe(true);
    expect(recentRound(NOW - RECENT_S, NOW)).toBe(true);
    expect(recentRound(NOW - RECENT_S - 1, NOW)).toBe(false);
  });

  test('round lines and awards', () => {
    const line = { steamId: H, name: 'Hid', faction: 'A', kills: 1, deaths: 1, headshots: 0, longest: 0, cash: 0, timePlayed: 1, killStreak: 1 };
    expect(maskLine(line, hidden)).toMatchObject({ steamId: '', name: HIDDEN_NAME });
    expect(maskAward({ key: 'k', label: 'Most kills', steamId: H, name: 'Hid', value: '9' }, hidden)).toMatchObject({ steamId: '', name: HIDDEN_NAME });
  });

  test("a hidden profile: not where, not when, no recent rounds or kills", () => {
    const p = withoutPresence(
      {
        onlineOn: { serverId: 's', serverName: 'EU#1' },
        lastSeen: NOW,
        matches: [
          { startedAt: NOW - 600, endedAt: null },
          { startedAt: NOW - 7200, endedAt: NOW - 3600 },
          { startedAt: NOW - 90_000, endedAt: NOW - 86_400 },
        ],
        recentKills: [kill(NOW - 60), kill(NOW - 86_400)],
      },
      NOW,
    );
    expect(p.onlineOn).toBeNull();
    expect(p.lastSeen).toBeNull();
    expect(p.matches).toEqual([{ startedAt: NOW - 90_000, endedAt: NOW - 86_400 }]);
    expect(p.recentKills.map((k) => k.ts)).toEqual([NOW - 86_400]);
  });
});
