import { describe, expect, it } from 'vitest';
import type { PlayerRating } from '../history/ratings';
import { openStore } from '../accounts/store';
import { balancerLook, type LiveRound } from './run';

const F = ['Manticore', 'Valkyra'];
const rating = (mu: number) => ({ skill: { mu, sigma: 2 } }) as PlayerRating;

function setup(mode: 'watch' | 'live') {
  const store = openStore(':memory:');
  const sent: string[] = [];
  // matches are named by when they started: m(500) began before the run was armed at 900
  let round: LiveRound = { startedAt: m(500), factions: F, players: [] };
  const ratings = new Map<string, PlayerRating>([['s1', rating(40)], ['s2', rating(40)], ['w1', rating(10)], ['w2', rating(10)], ['j1', rating(40)], ['j3', rating(40)]]);
  const deps = {
    store,
    live: async () => round,
    ratings: () => ratings,
    act: async (_s: string, action: string, body: Record<string, unknown>) => void sent.push(`${action} ${body.steamId} ${body.faction ?? body.message}`),
    sleep: async () => {},
  };
  const id = store.armBalance({ serverId: 'eu1', mode, message: 'To {team}', armedBy: '1', armedByName: 'Staff' }, 900)!;
  return { store, sent, deps, id, set: (r: Partial<LiveRound>) => (round = { ...round, ...r }) };
}
function m(t: number) {
  return new Date(t * 1000).toISOString();
}
const pl = (steamId: string, faction: string | null) => ({ steamId, name: steamId, faction });

describe('balancerLook', () => {
  it('waits for the next match, sorts it once, then places joiners, each player once', async () => {
    const t = setup('live');
    t.set({ players: [pl('s1', 'Manticore'), pl('s2', 'Manticore'), pl('w1', 'Valkyra'), pl('w2', 'Valkyra')] });
    await balancerLook(t.deps, 1000);
    expect(t.store.activeBalanceRuns()[0].status).toBe('armed');
    expect(t.sent).toEqual([]);

    t.set({ startedAt: m(1005) });
    // players are still loading in: no deal yet, and nobody is counted as weighed up
    await balancerLook(t.deps, 1010);
    expect(t.store.balanceMoves(t.id)).toEqual([]);
    await balancerLook(t.deps, 1100);
    // a strong player and a weak one swap sides
    const first = t.store.balanceMoves(t.id);
    expect(first.map((m) => [m.from, m.to, m.kind, m.sent])).toEqual([
      ['Manticore', 'Valkyra', 'start', true],
      ['Valkyra', 'Manticore', 'start', true],
    ]);
    expect(t.sent).toEqual(first.flatMap((m) => [`changeTeam ${m.steamId} ${m.to}`, `whisper ${m.steamId} To ${m.to}`]));

    // the game moves them; two strong joiners land on the same side
    const now = (id: string, f: string) => first.find((m) => m.steamId === id)?.to ?? f;
    const strongOnV = ['s1', 's2'].find((id) => now(id, 'Manticore') === 'Valkyra')!;
    t.set({ players: [pl('s1', now('s1', 'Manticore')), pl('s2', now('s2', 'Manticore')), pl('w1', now('w1', 'Valkyra')), pl('w2', now('w2', 'Valkyra')), pl('j1', 'Valkyra'), pl('j3', 'Valkyra')] });
    await balancerLook(t.deps, 1110);
    const after = t.store.balanceMoves(t.id);
    const joins = after.filter((m) => m.kind === 'join');
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ to: 'Manticore' });
    expect(['j1', 'j3']).toContain(joins[0].steamId);
    expect(after.filter((m) => m.steamId === strongOnV)).toHaveLength(1);
    // nobody already weighed up is moved again on later looks
    const count = after.length;
    await balancerLook(t.deps, 1120);
    expect(t.store.balanceMoves(t.id).length).toBe(count);

    t.set({ startedAt: m(1135) });
    await balancerLook(t.deps, 1140);
    expect(t.store.activeBalanceRuns()).toEqual([]);
    expect(t.store.balanceRuns()[0]).toMatchObject({ status: 'done', note: 'The match ended.' });
  });

  it('only logs in watch mode', async () => {
    const t = setup('watch');
    t.set({ startedAt: m(1005), players: [pl('s1', 'Manticore'), pl('s2', 'Manticore'), pl('w1', 'Valkyra'), pl('w2', 'Valkyra')] });
    await balancerLook(t.deps, 1000);
    await balancerLook(t.deps, 1100);
    expect(t.store.balanceMoves(t.id)).toHaveLength(2);
    expect(t.store.balanceMoves(t.id).every((m) => !m.sent)).toBe(true);
    expect(t.sent).toEqual([]);
  });

  it('records a refused move and cancels a live run with no move key', async () => {
    const t = setup('live');
    t.set({ startedAt: m(1005), players: [pl('s1', 'Manticore'), pl('s2', 'Manticore'), pl('w1', 'Valkyra'), pl('w2', 'Valkyra')] });
    const refuse = { ...t.deps, act: async () => Promise.reject(new Error('changeTeam: Warcon answered HTTP 403')) };
    await balancerLook(refuse, 1000);
    await balancerLook(refuse, 1100);
    expect(t.store.balanceMoves(t.id)[0]).toMatchObject({ sent: false, error: 'changeTeam: Warcon answered HTTP 403' });

    const u = setup('live');
    u.set({ startedAt: m(1005) });
    await balancerLook({ ...u.deps, act: null }, 1000);
    expect(u.store.balanceRuns()[0]).toMatchObject({ status: 'cancelled' });
  });

  it('refuses a second run on the same server', () => {
    const t = setup('watch');
    expect(t.store.armBalance({ serverId: 'eu1', mode: 'watch', message: '', armedBy: '1', armedByName: null })).toBeNull();
  });
});

describe('match-start re-deal', () => {
  it('deals a stacked full server out in one go, past the per-look cap for joiners', async () => {
    const t = setup('live');
    const ratings = new Map<string, PlayerRating>();
    const players: ReturnType<typeof pl>[] = [];
    for (let i = 0; i < 30; i++) {
      // the 15 best all on Manticore
      ratings.set(`p${i}`, rating(50 - i));
      players.push(pl(`p${i}`, i < 15 ? 'Manticore' : 'Valkyra'));
    }
    t.deps.ratings = () => ratings;
    t.set({ startedAt: m(1005), players });
    await balancerLook(t.deps, 1100);
    const moves = t.store.balanceMoves(t.id);
    expect(moves.length).toBeGreaterThan(6);
    expect(moves.every((x) => x.kind === 'start' && x.sent)).toBe(true);
    const side = (id: string) => moves.find((x) => x.steamId === id)?.to ?? players.find((p) => p.steamId === id)!.faction;
    const total = (f: string) => players.filter((p) => side(p.steamId) === f).reduce((a, p) => a + (50 - Number(p.steamId.slice(1))), 0);
    expect(Math.abs(total('Manticore') - total('Valkyra'))).toBeLessThan(20);
  });
});

describe('holding the sides', () => {
  const four = (a: string, b: string, c: string, d: string) => [pl('s1', a), pl('s2', b), pl('w1', c), pl('w2', d)];

  it('moves anyone who switches back to their side, every time; staff may switch', async () => {
    const t = setup('live');
    t.store.link('d-staff', 'w2');
    t.store.setTier('d-staff', 1);
    t.set({ startedAt: m(1005), players: four('Manticore', 'Valkyra', 'Manticore', 'Valkyra') });
    await balancerLook(t.deps, 1100);
    // everyone weighed up is held to the side they were dealt (moved or not)
    const side = new Map(t.store.balanceSides(t.id).map((x) => [x.steamId, x.faction]));
    expect(side.size).toBe(4);
    const other = (id: string) => (side.get(id) === 'Manticore' ? 'Valkyra' : 'Manticore');
    const sentBefore = t.sent.length;

    // s2 and staff w2 switch sides; inside the grace nothing happens
    t.set({ players: (['s1', 's2', 'w1', 'w2'] as const).map((id) => pl(id, id === 's2' || id === 'w2' ? other(id) : side.get(id)!)) });
    await balancerLook(t.deps, 1110);
    expect(t.sent.length).toBe(sentBefore);
    await balancerLook(t.deps, 1140);
    const back = side.get('s2');
    expect(t.sent.slice(sentBefore)).toEqual([`changeTeam s2 ${back}`, `whisper s2 Teams are locked this match to keep it balanced: you were moved back to ${back}.`]);

    // they switch again (the game never moved them): held again
    await balancerLook(t.deps, 1180);
    expect(t.sent.slice(sentBefore).filter((x) => x.startsWith('changeTeam'))).toEqual([`changeTeam s2 ${back}`, `changeTeam s2 ${back}`]);
    expect(t.store.balanceSides(t.id).find((x) => x.steamId === 's2')).toMatchObject({ faction: back, held: 2 });
    expect(t.store.balanceSides(t.id).find((x) => x.steamId === 'w2')).toMatchObject({ held: 0 });
  });

  it('watch-only counts each switch once and moves nobody', async () => {
    const t = setup('watch');
    t.set({ startedAt: m(1005), players: four('Manticore', 'Valkyra', 'Manticore', 'Valkyra') });
    await balancerLook(t.deps, 1100);
    const went = 'Manticore';
    t.set({ players: [pl('s1', 'Manticore'), pl('s2', went), pl('w1', 'Manticore'), pl('w2', 'Valkyra')] });
    await balancerLook(t.deps, 1140);
    await balancerLook(t.deps, 1180);
    expect(t.sent).toEqual([]);
    const sides = t.store.balanceSides(t.id);
    expect(sides.find((x) => x.steamId === 's2')).toMatchObject({ faction: went, held: 1 });
    // the rest never moved, so none of them count as switching
    expect(sides.filter((x) => x.steamId !== 's2').every((x) => x.held === 0)).toBe(true);
  });
});
