import { describe, expect, it, vi } from 'vitest';
import { rosterLook } from './rosters';
import { openHistory } from './store';

const START = Date.UTC(2026, 10, 16, 12) / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString();

function setup() {
  const history = openHistory(':memory:');
  const deps = {
    history,
    serverIds: async () => ['eu'],
    openMatch: vi.fn(async () => ({ id: 7, startedAt: iso(START) })),
    players: vi.fn(async () => [
      { steamId: 'a', faction: 'Manticore' },
      { steamId: 'b', faction: 'Valkyra' },
      { steamId: 'c', faction: null },
    ]),
  };
  return { history, deps };
}

describe('rosterLook', () => {
  it('takes who is on a side two minutes in, once per match', async () => {
    const { history, deps } = setup();
    expect((await rosterLook(deps, START + 60)).taken).toBe(0);
    expect((await rosterLook(deps, START + 130)).taken).toBe(1);
    expect(history.startRoster('eu', 7)).toEqual([
      { steamId: 'a', faction: 'Manticore' },
      { steamId: 'b', faction: 'Valkyra' },
    ]);
    expect((await rosterLook(deps, START + 160)).taken).toBe(0);
    expect(deps.players).toHaveBeenCalledTimes(1);
    expect(history.startRosterCount()).toBe(1);
  });

  it('skips a match it saw too late, between matches, and an empty server', async () => {
    const { history, deps } = setup();
    expect((await rosterLook(deps, START + 400)).taken).toBe(0);
    deps.openMatch.mockResolvedValueOnce(null as never);
    expect((await rosterLook(deps, START + 130)).taken).toBe(0);
    deps.players.mockResolvedValueOnce([]);
    expect((await rosterLook(deps, START + 130)).taken).toBe(0);
    expect(history.startRosterCount()).toBe(0);
  });

  it('a failing server is reported and the rest go on', async () => {
    const { deps } = setup();
    deps.serverIds = async () => ['bad', 'eu'];
    deps.openMatch.mockRejectedValueOnce(new Error('HTTP 502'));
    const r = await rosterLook(deps, START + 130);
    expect(r).toEqual({ taken: 1, errors: ['bad: HTTP 502'] });
  });
});
