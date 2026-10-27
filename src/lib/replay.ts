// A round played back: the score, the leaders and the kills at any moment, and the moments the
// round turned. Client-safe and pure; the data is getMatch's timeline and packed kills.

export interface ReplayData {
  people: { steamId: string | null; name: string; faction: string | null }[];
  causes: string[];
  /** [seconds in, killer index or -1, victim index, cause index or -1, flags, metres or -1], oldest first */
  kills: [number, number, number, number, number, number][];
}

export const HEADSHOT = 1;
export const TEAM_KILL = 2;
export const SUICIDE = 4;

/** Each faction's score at `t` seconds in: the last timeline row at or before it (zeros before the first). */
export function scoreAt(timeline: number[][], factions: number, t: number): number[] {
  let row: number[] | null = null;
  for (const r of timeline) {
    if (r[0] > t) break;
    row = r;
  }
  return Array.from({ length: factions }, (_, i) => row?.[i + 1] ?? 0);
}

export interface TurningPoint {
  t: number;
  /** index of the faction now ahead */
  faction: number;
  kind: 'lead' | 'retake';
}

/**
 * Every time a different faction went clear in front: the first lead, then each change of leader.
 * A tie isn't a change; 'retake' marks a faction getting back a lead it had lost.
 */
export function turningPoints(timeline: number[][], factions: number): TurningPoint[] {
  const out: TurningPoint[] = [];
  const led = new Set<number>();
  let leader = -1;
  for (const r of timeline) {
    const scores = Array.from({ length: factions }, (_, i) => r[i + 1] ?? 0);
    const top = Math.max(...scores);
    if (top <= 0 || scores.filter((s) => s === top).length > 1) continue;
    const now = scores.indexOf(top);
    if (now === leader) continue;
    out.push({ t: r[0], faction: now, kind: led.has(now) ? 'retake' : 'lead' });
    led.add(now);
    leader = now;
  }
  return out;
}

/** How many kills happened at or before `t` (kills are oldest first). */
export function killsBefore(kills: ReplayData['kills'], t: number): number {
  let lo = 0;
  let hi = kills.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kills[mid][0] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Kills and deaths per person up to the first `n` kills, best first. Team kills and suicides don't count as kills. */
export function standings(data: ReplayData, n: number): { person: number; kills: number; deaths: number }[] {
  const k = new Map<number, { person: number; kills: number; deaths: number }>();
  const at = (p: number) => k.get(p) ?? (k.set(p, { person: p, kills: 0, deaths: 0 }), k.get(p)!);
  for (let i = 0; i < n; i++) {
    const [, killer, victim, , flags] = data.kills[i];
    at(victim).deaths++;
    if (killer >= 0 && killer !== victim && !(flags & (TEAM_KILL | SUICIDE))) at(killer).kills++;
  }
  return [...k.values()].filter((s) => s.kills > 0).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}
