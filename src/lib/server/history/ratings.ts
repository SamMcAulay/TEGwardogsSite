// Skill ratings, worked out from every stored round in order (lib/rating.ts does the maths).
// Rebuilt whenever a round is added: a season is a few thousand rounds, well under a second.
import { displayRating, fresh, placesFromScores, rate, type Seat, type Skill } from '@/lib/rating';
import type { StoredLine, StoredRound } from './store';

/** Rounds that never drew this many players say little about anyone, and aren't rated. */
export const RATED_MIN_PEAK = 8;
/** A player on for less than this in a round isn't rated on it. */
const MIN_SECONDS = 120;
/** Rated rounds before a player shows on the skill board. */
export const RANKED_MIN_ROUNDS = 10;

export interface PlayerRating {
  steamId: string;
  skill: Skill;
  rating: number;
  rounds: number;
  /** unix seconds of the last rated round they played */
  lastPlayed: number;
  /** their rating at the end of each UTC day they played, oldest first */
  history: { day: string; rating: number }[];
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** The sides of a round, in score order, with each rated player's share of the round. */
export function sidesOf(round: StoredRound & { lines: StoredLine[] }): { teams: { faction: string; seats: { steamId: string; weight: number }[] }[]; places: number[] } | null {
  if (round.peak < RATED_MIN_PEAK || !round.winner) return null;
  const length = Math.max(1, round.endedAt - round.startedAt);
  const names = round.scores.length ? round.scores.map((s) => s.name) : [...new Set(round.lines.map((l) => l.faction).filter((f): f is string => !!f))];
  const teams = names
    .map((faction) => ({
      faction,
      seats: round.lines
        .filter((l) => l.faction === faction && l.seconds >= MIN_SECONDS)
        .map((l) => ({ steamId: l.steamId, weight: Math.min(1, l.seconds / length) })),
    }))
    .filter((t) => t.seats.length);
  if (teams.length < 2 || !teams.some((t) => t.faction === round.winner)) return null;
  const score = (f: string) => round.scores.find((s) => s.name === f)?.score;
  let places = round.scores.length ? placesFromScores(teams.map((t) => score(t.faction) ?? 0)) : [];
  // The winner Warcon names always comes first, whatever the scores say.
  const w = teams.findIndex((t) => t.faction === round.winner);
  if (places[w] !== 1 || places.filter((p) => p === 1).length > 1 || !places.length) {
    places = teams.map((t) => (t.faction === round.winner ? 1 : 2));
  }
  return { teams, places };
}

/** Everyone's rating after the given rounds, taken oldest first. */
export function buildRatings(rounds: (StoredRound & { lines: StoredLine[] })[]): Map<string, PlayerRating> {
  const players = new Map<string, PlayerRating>();
  for (const round of [...rounds].sort((a, b) => a.endedAt - b.endedAt)) {
    const sides = sidesOf(round);
    if (!sides) continue;
    const seats: Seat[][] = sides.teams.map((t) => t.seats.map((s) => ({ skill: players.get(s.steamId)?.skill ?? fresh(), weight: s.weight })));
    const after = rate(seats, sides.places);
    const day = dayOf(round.endedAt);
    sides.teams.forEach((t, i) =>
      t.seats.forEach((s, j) => {
        const skill = after[i][j];
        const p = players.get(s.steamId) ?? { steamId: s.steamId, skill, rating: 0, rounds: 0, lastPlayed: 0, history: [] };
        p.skill = skill;
        p.rating = displayRating(skill);
        p.rounds++;
        p.lastPlayed = round.endedAt;
        if (p.history.at(-1)?.day === day) p.history[p.history.length - 1].rating = p.rating;
        else p.history.push({ day, rating: p.rating });
        players.set(s.steamId, p);
      }),
    );
  }
  return players;
}

/** A player's rating as it stood at the end of `day` (null before their first rated round). */
export function ratingOn(p: PlayerRating, day: string): number | null {
  let out: number | null = null;
  for (const h of p.history) {
    if (h.day > day) break;
    out = h.rating;
  }
  return out;
}

/**
 * Each side's strength right now: the summed skill of who's on it (unrated players count as
 * newcomers), and the chance each side would win if the round started like this.
 */
export function sideStrength(sides: { faction: string; steamIds: string[] }[], ratings: Map<string, PlayerRating>): { faction: string; players: number; mu: number; chance: number }[] {
  const teams = sides.map((s) => {
    const skills = s.steamIds.map((id) => ratings.get(id)?.skill ?? fresh());
    return { faction: s.faction, players: s.steamIds.length, mu: skills.reduce((a, k) => a + k.mu, 0), sigmaSq: skills.reduce((a, k) => a + k.sigma ** 2, 0) };
  });
  const beta = fresh().sigma / 2;
  const c = Math.sqrt(teams.reduce((a, t) => a + t.sigmaSq + beta ** 2, 0)) || 1;
  const exp = teams.map((t) => Math.exp(t.mu / c));
  const sum = exp.reduce((a, e) => a + e, 0) || 1;
  return teams.map((t, i) => ({ faction: t.faction, players: t.players, mu: t.mu, chance: exp[i] / sum }));
}
