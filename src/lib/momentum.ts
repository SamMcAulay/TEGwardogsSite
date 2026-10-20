// Round momentum: kills per stretch of the round for each faction, from the kill feed. Client-safe.

export interface MomentumKill {
  /** seconds into the round (the feed's match clock) */
  t: number;
  /** the killer's faction; null for no killer (the environment) */
  faction: string | null;
  /** team kills and suicides don't count for anyone */
  own: boolean;
}

export interface Momentum {
  /** seconds per bucket: 1, 2, 3 or 5 minutes, so a round has at most MAX_BUCKETS */
  bucketS: number;
  /** one per bucket from the round's start: kills by each faction, in `factions` order */
  buckets: number[][];
  /** the bucket where one side out-killed the other by the most, or null (no kills, or not two sides) */
  swing: { index: number; leader: number } | null;
}

const MAX_BUCKETS = 40;
const SIZES = [60, 120, 180, 300];

export function momentum(kills: MomentumKill[], factions: string[], roundSeconds: number): Momentum {
  const end = Math.max(roundSeconds, ...kills.map((k) => k.t), 1);
  const bucketS = SIZES.find((s) => Math.ceil(end / s) <= MAX_BUCKETS) ?? Math.ceil(end / MAX_BUCKETS / 60) * 60;
  const buckets = Array.from({ length: Math.max(1, Math.ceil(end / bucketS)) }, () => factions.map(() => 0));
  for (const k of kills) {
    const side = k.faction ? factions.indexOf(k.faction) : -1;
    if (k.own || side < 0 || k.t < 0) continue;
    buckets[Math.min(buckets.length - 1, Math.floor(k.t / bucketS))][side]++;
  }
  let swing: Momentum['swing'] = null;
  if (factions.length === 2) {
    let best = 0;
    buckets.forEach(([a, b], index) => {
      if (Math.abs(a - b) > best) {
        best = Math.abs(a - b);
        swing = { index, leader: a > b ? 0 : 1 };
      }
    });
  }
  return { bucketS, buckets, swing };
}
