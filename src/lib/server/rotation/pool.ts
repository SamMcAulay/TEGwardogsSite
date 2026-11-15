// The weighted map rotation (staff /admin/rotation): which entries it picks from, how each is
// scored and how the next one is picked. Pure: the job (./run.ts) does the reading and writing.

export type Kind = 'clear' | 'morning' | 'rain';

export interface PoolEntry {
  /** "Bakurani/DayClear": the score's key */
  key: string;
  /** in-game name, as the live status and the rest of the site show it */
  map: string;
  /** the game's ids, as the config document's rotation wants them */
  mapId: string;
  experiences: string;
  lighting: string;
  kind: Kind;
}

/** Score an entry starts on, and what each time it is played adds. Rain is picked least, clear most. */
export const START: Record<Kind, number> = { clear: 0, morning: 0.75, rain: 1.5 };
export const STEP: Record<Kind, number> = { clear: 1, morning: 1.25, rain: 1.5 };
/** How hard the pick leans to the lowest scores: an entry 1 point above the lowest is e² ≈ 7× less likely. */
export const LEAN = 2;

const LIGHTING: Record<Kind, string> = { clear: 'DayClear', morning: 'DayStartClear', rain: 'DayLateRain' };
const MAPS: { map: string; mapId: string; experiences: string; kinds: Kind[] }[] = [
  // Sabatulo has no early-morning lighting.
  { map: 'Sabatulo', mapId: 'Russia', experiences: 'Moscow_KOTH_01+KOTH_LimitedGear', kinds: ['clear', 'rain'] },
  { map: 'Bakurani', mapId: 'Kavkazi', experiences: 'Bakurani_KOTH_02+KOTH_LimitedGear', kinds: ['clear', 'morning', 'rain'] },
  { map: 'Ozeti', mapId: 'Europe', experiences: 'Madrid_KOTH_01+KOTH_LimitedGear', kinds: ['clear', 'morning', 'rain'] },
  { map: 'Zestafona', mapId: 'NorthAmerica', experiences: 'Detroit_KOTH_01+KOTH_LimitedGear', kinds: ['clear', 'morning', 'rain'] },
];

export const POOL: readonly PoolEntry[] = MAPS.flatMap((m) =>
  m.kinds.map((kind) => ({ key: `${m.map}/${LIGHTING[kind]}`, map: m.map, mapId: m.mapId, experiences: m.experiences, lighting: LIGHTING[kind], kind })),
);

/** The pool entry for what a server is playing, by in-game name or id; null for anything else. */
export function entryOf(map: string | null | undefined, lighting: string | null | undefined): PoolEntry | null {
  const m = (map ?? '').toLowerCase();
  const l = (lighting ?? '').toLowerCase();
  return POOL.find((e) => (e.map.toLowerCase() === m || e.mapId.toLowerCase() === m) && e.lighting.toLowerCase() === l) ?? null;
}

/** Every entry's score: the stored one, or its starting score. */
export function scoresOf(stored: Map<string, number>): Map<string, number> {
  return new Map(POOL.map((e) => [e.key, stored.get(e.key) ?? START[e.kind]]));
}

/**
 * Each entry's chance of being picked next. Never the map being played (in any lighting), so the
 * same map doesn't come round twice in a row; the rest by e^(−LEAN × (score − lowest)).
 */
export function chances(scores: Map<string, number>, playing: string | null): Map<string, number> {
  const others = POOL.filter((e) => e.map !== playing);
  const lowest = Math.min(...others.map((e) => scores.get(e.key)!));
  const weights = others.map((e) => Math.exp(-LEAN * (scores.get(e.key)! - lowest)));
  const total = weights.reduce((a, b) => a + b, 0);
  return new Map(others.map((e, i) => [e.key, weights[i] / total]));
}

export function pickNext(scores: Map<string, number>, playing: string | null, random: () => number = Math.random): PoolEntry {
  let r = random();
  const odds = [...chances(scores, playing)];
  for (const [key, p] of odds) {
    r -= p;
    if (r < 0) return POOL.find((e) => e.key === key)!;
  }
  return POOL.find((e) => e.key === odds[odds.length - 1][0])!;
}

/** The entry as a config document rotation line's value. */
export const configEntry = (e: PoolEntry) => `(Map="${e.mapId}",Experiences="${e.experiences}",Lighting="${e.lighting}")`;
