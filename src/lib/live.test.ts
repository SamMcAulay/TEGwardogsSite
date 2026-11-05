import { describe, expect, it } from 'vitest';
import type { FriendStatus } from '@/lib/server/views';
import { defaultOpenServer, friendsByServer, keepOpen, killerLine, roundHeadline, type TabServer } from './live';

const sc = (...s: [string, number][]) => s.map(([name, score]) => ({ name, score }));
const head = (...s: [string, number][]) => roundHeadline({ map: 'Ozeti', scores: sc(...s), cap: 100 });

describe('roundHeadline', () => {
  it('says a round has just started when nobody has scored', () => {
    expect(roundHeadline({ map: 'Ozeti', scores: [], cap: 100 })).toBe('Round just started on Ozeti.');
    expect(roundHeadline({ map: null, scores: sc(['Manticore', 0], ['Lonestar', 0]), cap: 100 })).toBe('Round just started on the map.');
  });

  it('calls a round with all three close dead even', () => {
    expect(head(['Lonestar', 47], ['Manticore', 44], ['Valkyra', 40])).toBe('Dead even on Ozeti.');
  });

  it('calls two leaders within 3 neck and neck', () => {
    expect(head(['Valkyra', 71], ['Lonestar', 70], ['Manticore', 22])).toBe('Valkyra and Lonestar, neck and neck.');
  });

  it('counts down the last 20 points', () => {
    expect(head(['Manticore', 82], ['Lonestar', 61], ['Valkyra', 34])).toBe('Manticore are 18 points from taking it.');
    expect(head(['Manticore', 99], ['Lonestar', 61], ['Valkyra', 34])).toBe('Manticore are 1 point from taking it.');
  });

  it('notices a runaway lead', () => {
    expect(head(['Manticore', 60], ['Lonestar', 30], ['Valkyra', 20])).toBe('Manticore are running away with it.');
  });

  it('falls back to the plain score', () => {
    expect(head(['Manticore', 50], ['Lonestar', 40], ['Valkyra', 20])).toBe('Manticore lead 50–40–20.');
  });

  it('reports a finished round', () => {
    expect(head(['Valkyra', 100], ['Lonestar', 46], ['Manticore', 37])).toBe('Valkyra have taken it.');
  });
});

describe('killerLine', () => {
  it('names a top killer with 10 or more', () => {
    expect(killerLine({ name: 'Kreeg', kills: 31 })).toBe('Kreeg has 31 kills.');
    expect(killerLine({ name: 'x', kills: 9 })).toBeNull();
    expect(killerLine(undefined)).toBeNull();
  });
});

const server = (id: string, playerCount: number, over: Partial<TabServer> = {}): TabServer => ({
  id,
  shortName: id,
  slug: id,
  online: true,
  playerCount,
  maxPlayers: 50,
  map: 'Ozeti',
  lighting: null,
  scores: sc(['Manticore', 10], ['Lonestar', 5], ['Valkyra', 1]),
  cap: 100,
  roundSeconds: null,
  topKillers: [],
  ...over,
});

describe('defaultOpenServer', () => {
  it('opens the busiest live server', () => {
    expect(defaultOpenServer([server('a', 10), server('b', 40), server('c', 20)])).toBe('b');
  });

  it('skips offline, unknown and scoreless servers', () => {
    const list = [server('a', 90, { online: false }), server('b', 80, { online: null }), server('c', 70, { scores: [] }), server('d', 5)];
    expect(defaultOpenServer(list)).toBe('d');
    expect(defaultOpenServer(list.slice(0, 3))).toBeNull();
  });
});

describe('keepOpen', () => {
  it("keeps the viewer's pick while that server stays live", () => {
    expect(keepOpen('b', [server('a', 40), server('b', 10)])).toBe('b');
  });

  it('falls back to the busiest when their pick goes down', () => {
    expect(keepOpen('b', [server('a', 40), server('b', 10, { online: false })])).toBe('a');
    expect(keepOpen(null, [server('a', 40)])).toBe('a');
  });
});

const friend = (steamId: string, name: string | null, serverId: string | null): FriendStatus => ({
  steamId,
  name,
  avatarUrl: null,
  online: serverId ? { serverId, serverName: serverId, serverSlug: serverId, faction: 'Manticore', kills: 0, deaths: 0 } : null,
  lastSeen: null,
});

describe('friendsByServer', () => {
  it('groups friends by the server they are on', () => {
    expect(friendsByServer([friend('1', 'Moth', 'a'), friend('2', 'Ashe', 'a'), friend('3', 'Rook', 'b')])).toEqual({
      a: [
        { steamId: '1', name: 'Moth' },
        { steamId: '2', name: 'Ashe' },
      ],
      b: [{ steamId: '3', name: 'Rook' }],
    });
  });

  it('leaves out friends who hide where they play or have no name', () => {
    expect(friendsByServer([friend('1', 'Moth', null), friend('2', null, 'a')])).toEqual({});
  });
});
