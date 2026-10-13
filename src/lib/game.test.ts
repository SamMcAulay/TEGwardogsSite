import { describe, expect, it } from 'vitest';
import { mainFaction } from './game';

describe('mainFaction', () => {
  it('picks a faction holding at least 65% of rounds', () => {
    expect(mainFaction([{ key: 'Valkyra', matches: 72 }, { key: 'Lonestar', matches: 28 }])).toBe('Valkyra');
    expect(mainFaction([{ key: 'Manticore', matches: 65 }, { key: 'Lonestar', matches: 35 }])).toBe('Manticore');
  });

  it('returns null below the threshold, with no rounds, or for unknown factions', () => {
    expect(mainFaction([{ key: 'Valkyra', matches: 50 }, { key: 'Lonestar', matches: 50 }])).toBeNull();
    expect(mainFaction([{ key: 'Valkyra', matches: 64 }, { key: 'Lonestar', matches: 36 }])).toBeNull();
    expect(mainFaction([])).toBeNull();
    expect(mainFaction([{ key: 'Valkyra', matches: 0 }])).toBeNull();
    expect(mainFaction([{ key: 'Pirates', matches: 90 }, { key: 'Valkyra', matches: 10 }])).toBeNull();
  });
});
