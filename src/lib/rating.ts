// Skill rating: Weng and Lin's Bayesian rating with the Plackett-Luce model (the maths behind
// OpenSkill), for rounds of several teams. Each player has a mean skill (mu) and an uncertainty
// (sigma); a round moves the winners up and the losers down, by more for the less certain, and by
// how much of the round each player was there for. Client-safe and pure.

export interface Skill {
  mu: number;
  sigma: number;
}

export const MU = 25;
export const SIGMA = MU / 3;
/** How far apart two skills must be for the better one to win about 76% of the time. */
const BETA = SIGMA / 2;
/** Added uncertainty each round, so a rating keeps moving as a player gets better or worse. */
const TAU = MU / 300;
/** The floor on how much one round may shrink sigma. */
const KAPPA = 0.0001;

export const fresh = (): Skill => ({ mu: MU, sigma: SIGMA });

/** One player on one side of a round: their skill going in and the share of the round they played (0 to 1). */
export interface Seat {
  skill: Skill;
  weight: number;
}

/**
 * New skills after one round. rank: each team's place, 1 the winner; equal ranks are a draw
 * between those teams. A team's strength is the sum of its players' skills, weighted by time
 * played, so a fuller team counts as stronger. Returns the teams' new skills in the same shape.
 * tau: uncertainty added first (0 to rate exactly as OpenSkill does without it).
 */
export function rate(teams: Seat[][], rank: number[], tau = TAU): Skill[][] {
  const withTau = teams.map((t) => t.map((s) => ({ ...s, skill: { mu: s.skill.mu, sigma: Math.sqrt(s.skill.sigma ** 2 + tau ** 2) } })));
  const team = withTau.map((t) => ({
    mu: t.reduce((a, s) => a + s.weight * s.skill.mu, 0),
    sigmaSq: t.reduce((a, s) => a + s.weight * s.skill.sigma ** 2, 0),
  }));
  const c = Math.sqrt(team.reduce((a, t) => a + t.sigmaSq + BETA ** 2, 0));
  const exp = team.map((t) => Math.exp(t.mu / c));
  // For each team q: the sum over teams placed no better than q, and how many share q's place.
  const sumQ = team.map((_, q) => team.reduce((a, _t, s) => (rank[s] >= rank[q] ? a + exp[s] : a), 0));
  const tied = team.map((_, q) => rank.filter((r) => r === rank[q]).length);
  return withTau.map((seats, i) => {
    let omega = 0;
    let delta = 0;
    for (let q = 0; q < team.length; q++) {
      if (rank[q] > rank[i]) continue;
      const p = exp[i] / sumQ[q];
      omega += (i === q ? 1 - p : -p) / tied[q];
      delta += (p * (1 - p)) / tied[q];
    }
    const { sigmaSq } = team[i];
    if (sigmaSq <= 0) return seats.map((s) => s.skill);
    const gamma = Math.sqrt(sigmaSq) / c;
    const teamOmega = (omega * sigmaSq) / c;
    const teamDelta = (gamma * delta * sigmaSq) / c ** 2;
    return seats.map(({ skill, weight }) => {
      const share = (weight * skill.sigma ** 2) / sigmaSq;
      return {
        mu: skill.mu + share * teamOmega,
        sigma: skill.sigma * Math.sqrt(Math.max(1 - share * teamDelta, KAPPA)),
      };
    });
  });
}

/**
 * The number shown on the site: a cautious estimate (mu less three sigmas, so a newcomer starts
 * low and climbs as the site gets sure of them) on a 1,000-centred scale.
 */
export function displayRating(s: Skill): number {
  return Math.round(1000 + (s.mu - 3 * s.sigma) * 40);
}

/** Places from final scores, highest first; equal scores share a place. */
export function placesFromScores(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}
