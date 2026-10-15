import { describe, expect, test, vi } from 'vitest';
import { factionTag, isNewPlayer, NewPlayers, seasonOneMain } from './live-tags';
import seasonOne from './season-one-factions.json';

const LONESTAR_MAIN = seasonOne.Lonestar[0];
const VALKYRA_MAIN = seasonOne.Valkyra[0];
const STRANGER = '76561190000000001';

describe('factionTag', () => {
  test('a Valkyra or Manticore main on Lonestar is a Blue Imposter', () => {
    expect(factionTag('Lonestar', 'Valkyra')).toBe('imposter');
    expect(factionTag('Lonestar', 'Manticore')).toBe('imposter');
  });
  test('a Lonestar main is a Blue Lover on any side', () => {
    expect(factionTag('Lonestar', 'Lonestar')).toBe('lover');
    expect(factionTag('Valkyra', 'Lonestar')).toBe('lover');
    expect(factionTag('Manticore', 'Lonestar')).toBe('lover');
  });
  test('a Valkyra or Manticore main off Lonestar, or no main at all, is no tag', () => {
    expect(factionTag('Valkyra', 'Valkyra')).toBeNull();
    expect(factionTag('Valkyra', 'Manticore')).toBeNull();
    expect(factionTag('Lonestar', null)).toBeNull();
    expect(factionTag('', 'Lonestar')).toBeNull();
  });
});

describe('seasonOneMain', () => {
  test('reads the frozen season-one snapshot', () => {
    expect(seasonOneMain(LONESTAR_MAIN)).toBe('Lonestar');
    expect(seasonOneMain(VALKYRA_MAIN)).toBe('Valkyra');
    expect(seasonOneMain(STRANGER)).toBeNull();
  });
});

test('new means under 45 minutes or still on a first session', () => {
  expect(isNewPlayer({ sessions: 3, minutes: 44 })).toBe(true);
  expect(isNewPlayer({ sessions: 1, minutes: 120 })).toBe(true);
  expect(isNewPlayer({ sessions: 2, minutes: 45 })).toBe(false);
});

describe('NewPlayers', () => {
  function setup(answers: Record<string, { sessions: number; minutes: number }>, known: Record<string, number> = {}) {
    let t = 0;
    const summary = vi.fn(async (id: string) => {
      if (!answers[id]) throw new Error('busy');
      return answers[id];
    });
    const knownMinutes = vi.fn(async (id: string) => known[id] ?? null);
    const np = new NewPlayers({ summary, knownMinutes, now: () => t });
    return { np, summary, advance: (ms: number) => (t += ms) };
  }

  test('tags new players and remembers veterans without asking again', async () => {
    const { np, summary } = setup({ a: { sessions: 1, minutes: 5 }, b: { sessions: 9, minutes: 300 } });
    expect(await np.check(['a', 'b'])).toEqual(new Set(['a']));
    expect(await np.check(['a', 'b'])).toEqual(new Set(['a']));
    expect(summary).toHaveBeenCalledTimes(2);
  });

  test('season-one mains and long-time players in the search index cost no lookup', async () => {
    const { np, summary } = setup({}, { c: 600 });
    expect(await np.check([LONESTAR_MAIN, 'c'])).toEqual(new Set());
    expect(summary).not.toHaveBeenCalled();
  });

  test('a new player is asked again after five minutes and loses the tag past 45', async () => {
    const answers = { a: { sessions: 1, minutes: 40 } };
    const { np, summary, advance } = setup(answers);
    expect(await np.check(['a'])).toEqual(new Set(['a']));
    answers.a = { sessions: 2, minutes: 46 };
    advance(60_000);
    expect(await np.check(['a'])).toEqual(new Set(['a']));
    advance(5 * 60_000);
    expect(await np.check(['a'])).toEqual(new Set());
    expect(summary).toHaveBeenCalledTimes(2);
  });

  test('a failed lookup leaves the player untagged', async () => {
    const { np } = setup({});
    expect(await np.check(['x'])).toEqual(new Set());
  });

  test('does not wait past its budget; slow answers show on the next check', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const np = new NewPlayers({
      summary: async () => {
        await gate;
        return { sessions: 1, minutes: 1 };
      },
      knownMinutes: async () => null,
    });
    expect(await np.check(['a'], 10)).toEqual(new Set());
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(await np.check(['a'], 10)).toEqual(new Set(['a']));
  });
});
