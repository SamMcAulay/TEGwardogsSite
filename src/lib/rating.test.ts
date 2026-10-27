import { describe, expect, it } from 'vitest';
import { displayRating, fresh, placesFromScores, rate, type Seat } from './rating';

const seats = (n: number, weight = 1): Seat[] => Array.from({ length: n }, () => ({ skill: fresh(), weight }));

describe('rate', () => {
  // Reference values from openskill 4.1.0's Plackett-Luce model with default settings.
  it('matches OpenSkill for a one-on-one', () => {
    const [[a], [b]] = rate([seats(1), seats(1)], [1, 2], 0);
    expect(a.mu).toBeCloseTo(27.63523138347365, 9);
    expect(a.sigma).toBeCloseTo(8.065506316323548, 9);
    expect(b.mu).toBeCloseTo(22.36476861652635, 9);
  });

  it('matches OpenSkill for three teams of two', () => {
    const out = rate([seats(2), seats(2), seats(2)], [2, 1, 3], 0);
    expect(out[0][0].mu).toBeCloseTo(25.534583582582986, 9);
    expect(out[1][1].mu).toBeCloseTo(27.138334330331947, 9);
    expect(out[1][1].sigma).toBeCloseTo(8.258327598736198, 9);
    expect(out[2][0].mu).toBeCloseTo(22.327082087085067, 9);
  });

  it('matches OpenSkill for a draw between uneven players', () => {
    const [[a], [b]] = rate(
      [[{ skill: { mu: 30, sigma: 4 }, weight: 1 }], [{ skill: { mu: 20, sigma: 7 }, weight: 1 }]],
      [1, 1],
      0,
    );
    expect(a.mu).toBeCloseTo(29.62935344238246, 9);
    expect(a.sigma).toBeCloseTo(3.974664469716388, 9);
    expect(b.mu).toBeCloseTo(21.13510508270372, 9);
  });

  it('moves a player who was there for part of the round by less', () => {
    const [[full, part]] = rate([[{ skill: fresh(), weight: 1 }, { skill: fresh(), weight: 0.2 }], seats(2)], [1, 2], 0);
    expect(full.mu - 25).toBeGreaterThan(part.mu - 25);
    expect(part.mu).toBeGreaterThan(25);
  });

  it('leaves a player with no time unchanged apart from the added uncertainty', () => {
    const [[ghost]] = rate([[{ skill: fresh(), weight: 0 }], seats(2)], [1, 2], 0);
    expect(ghost).toEqual(fresh());
  });
});

describe('displayRating', () => {
  it('starts a newcomer at 1,000 and climbs as sigma shrinks', () => {
    expect(displayRating(fresh())).toBe(1000);
    expect(displayRating({ mu: 25, sigma: 4 })).toBeGreaterThan(1000);
  });
});

describe('placesFromScores', () => {
  it('ranks highest first, sharing places on a tie', () => {
    expect(placesFromScores([40, 100, 40])).toEqual([2, 1, 2]);
  });
});
