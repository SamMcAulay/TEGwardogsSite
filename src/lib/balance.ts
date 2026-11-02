// Match balance for staff (/admin/balance): how close each round was, how the sides compared on
// numbers, skill, gunfights and teamwork, and a best guess at why it went the way it did.
// Pure; the rounds come from history.db, refrags from each round's kill feed.

/** A death is traded (refragged) when a teammate kills the killer within this many seconds. */
export const REFRAG_SECONDS = 10;

/** One side's teamwork in a round: deaths to the enemy, and how many of those were traded. */
export interface Teamplay {
  deaths: number;
  refrags: number;
}

interface FeedKill {
  eventTime: number;
  killer: { steamId: string; faction: string | null } | null;
  victim: { steamId: string; faction: string | null };
  teamKill: boolean;
  suicide: boolean;
}

/**
 * Each faction's refrags in a round: X dies to K, and within REFRAG_SECONDS a teammate of X
 * kills K. One avenging kill counts once, however many teammates K had just killed.
 */
export function refrags(kills: FeedKill[]): Record<string, Teamplay> {
  const out: Record<string, Teamplay> = {};
  const side = (f: string) => (out[f] ??= { deaths: 0, refrags: 0 });
  // deaths still waiting to be traded: who killed whom, when
  let open: { t: number; killer: string; faction: string }[] = [];
  for (const k of [...kills].sort((a, b) => a.eventTime - b.eventTime)) {
    if (!k.killer || k.teamKill || k.suicide || !k.killer.faction || !k.victim.faction) continue;
    const t = k.eventTime;
    open = open.filter((d) => t - d.t <= REFRAG_SECONDS);
    const avenged = open.filter((d) => d.killer === k.victim.steamId && d.faction === k.killer!.faction);
    if (avenged.length) {
      side(k.killer.faction).refrags++;
      open = open.filter((d) => !avenged.includes(d));
    }
    side(k.victim.faction).deaths++;
    open.push({ t, killer: k.killer.steamId, faction: k.victim.faction });
  }
  return out;
}

/**
 * How close a round was, 0-100: each losing side's score as a share of the winner's, averaged.
 * 100-99-99 is 99; 0-100-0 is 0. Null when there's nothing to compare.
 */
export function closeness(scores: number[]): number | null {
  if (scores.length < 2) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  if (sorted[0] <= 0) return null;
  const rest = sorted.slice(1);
  return Math.round((rest.reduce((a, s) => a + s / sorted[0], 0) / rest.length) * 100);
}

export type Band = 'close' | 'fair' | 'one-sided' | 'landslide';
export const BANDS: { band: Band; label: string; min: number }[] = [
  { band: 'close', label: 'Close', min: 85 },
  { band: 'fair', label: 'Fair', min: 60 },
  { band: 'one-sided', label: 'One-sided', min: 35 },
  { band: 'landslide', label: 'Landslide', min: 0 },
];
export const bandOf = (c: number): Band => BANDS.find((b) => c >= b.min)!.band;

export interface SideLine {
  faction: string | null;
  seconds: number;
  kills: number;
  deaths: number;
  headshots: number;
}

export interface Side {
  faction: string;
  score: number;
  /** players who were on for 2 minutes or more */
  players: number;
  /** how many were on at once, on average: player-seconds over the round's length */
  avgOn: number;
  kills: number;
  deaths: number;
  headshots: number;
  /** kills per player-minute */
  kpm: number;
  /** deaths per player-minute */
  dpm: number;
  /** the side's average skill rating going in, and its chance of winning by those ratings */
  rating: number | null;
  chance: number | null;
  teamplay: Teamplay | null;
}

export type ReasonKind = 'numbers' | 'skill' | 'gunfights' | 'teamwork' | 'even' | 'upset';
export interface Reason {
  kind: ReasonKind;
  text: string;
}

export interface Analysed {
  closeness: number;
  band: Band;
  winner: string;
  sides: Side[];
  reasons: Reason[];
}

export const kdOf = (s: { kills: number; deaths: number }) => s.kills / Math.max(1, s.deaths);
export const tradeRate = (t: Teamplay | null) => (t && t.deaths ? t.refrags / t.deaths : null);

/** One round's sides, worst-to-best not implied: in the round's score order. */
export function sidesOf(
  round: { startedAt: number; endedAt: number; scores: { name: string; score: number }[]; lines: SideLine[]; teamplay?: Record<string, Teamplay> | null },
  pre: { faction: string; rating: number; chance: number }[] | undefined,
): Side[] {
  const length = Math.max(1, round.endedAt - round.startedAt);
  return round.scores.map(({ name, score }) => {
    const lines = round.lines.filter((l) => l.faction === name);
    const sum = (k: 'seconds' | 'kills' | 'deaths' | 'headshots') => lines.reduce((a, l) => a + l[k], 0);
    const minutes = Math.max(1, sum('seconds') / 60);
    const p = pre?.find((x) => x.faction === name);
    return {
      faction: name,
      score,
      players: lines.filter((l) => l.seconds >= 120).length,
      avgOn: sum('seconds') / length,
      kills: sum('kills'),
      deaths: sum('deaths'),
      headshots: sum('headshots'),
      kpm: sum('kills') / minutes,
      dpm: sum('deaths') / minutes,
      rating: p?.rating ?? null,
      chance: p?.chance ?? null,
      teamplay: round.teamplay ? (round.teamplay[name] ?? { deaths: 0, refrags: 0 }) : null,
    };
  });
}

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const pc = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);

/**
 * Best guess at why the winner won by as much as they did, comparing them with the average of
 * the sides they beat. Communication can't be measured: when the winner was no bigger, no better
 * rated and no better in the gunfights and still won big, that's what's left.
 */
export function reasonsFor(sides: Side[], winner: string, band: Band): Reason[] {
  const w = sides.find((s) => s.faction === winner);
  const rest = sides.filter((s) => s.faction !== winner);
  if (!w || !rest.length) return [];
  const out: Reason[] = [];
  const restOn = mean(rest.map((s) => s.avgOn));
  if (restOn > 0 && w.avgOn / restOn >= 1.15) {
    out.push({ kind: 'numbers', text: `More players: ${winner} averaged ${f1(w.avgOn)} on at once against ${f1(restOn)}.` });
  }
  const fair = 1 / sides.length;
  if (w.chance != null && w.chance - fair >= 0.12) {
    out.push({ kind: 'skill', text: `Stacked on skill: ratings gave ${winner} a ${pc(w.chance)} chance going in (an even round is ${pc(fair)}).` });
  }
  const restKd = mean(rest.map(kdOf));
  if (kdOf(w) / Math.max(0.01, restKd) >= 1.3) {
    out.push({
      kind: 'gunfights',
      text: `Won the gunfights: K/D ${f2(kdOf(w))} against ${f2(restKd)}, ${f2(w.kpm)} kills a minute each against ${f2(mean(rest.map((s) => s.kpm)))}.`,
    });
  }
  const wt = tradeRate(w.teamplay);
  const rt = rest.map((s) => tradeRate(s.teamplay)).filter((x): x is number => x != null);
  if (wt != null && rt.length && wt - mean(rt) >= 0.05) {
    out.push({ kind: 'teamwork', text: `Traded better: ${pc(wt)} of ${winner}'s deaths were avenged within ${REFRAG_SECONDS}s, against ${pc(mean(rt))}. Playing closer together.` });
  }
  if (w.chance != null && fair - w.chance >= 0.1) {
    out.push({ kind: 'upset', text: `Upset: ratings gave ${winner} only ${pc(w.chance)} going in.` });
  }
  if (!out.some((r) => r.kind !== 'upset')) {
    out.push(
      band === 'close' || band === 'fair'
        ? { kind: 'even', text: 'Evenly matched on numbers, skill and gunfights.' }
        : { kind: 'even', text: `Numbers, skill and gunfights were even, yet ${winner} won big: most likely the objective play and communication.` },
    );
  }
  return out;
}

export function analyse(
  round: Parameters<typeof sidesOf>[0] & { winner: string | null },
  pre?: { faction: string; rating: number; chance: number }[],
): Analysed | null {
  const c = closeness(round.scores.map((s) => s.score));
  if (c == null || !round.winner) return null;
  const sides = sidesOf(round, pre);
  const band = bandOf(c);
  return { closeness: c, band, winner: round.winner, sides, reasons: reasonsFor(sides, round.winner, band) };
}

export interface SideTotals {
  faction: string;
  rounds: number;
  wins: number;
  /** wins that were one-sided or a landslide */
  bigWins: number;
  /** closeness of the rounds they won, averaged */
  winCloseness: number;
  avgOn: number;
  kills: number;
  deaths: number;
  headshots: number;
  kpm: number;
  rating: number | null;
  /** what ratings expected their win rate to be */
  expected: number | null;
  teamplay: Teamplay | null;
  /** why their big wins happened: reason kind -> rounds */
  why: Partial<Record<ReasonKind, number>>;
}

/** Each faction's totals across many analysed rounds, most wins first. */
export function sideTotals(rounds: Analysed[]): SideTotals[] {
  const by = new Map<string, { s: Side[]; wins: Analysed[] }>();
  for (const a of rounds) {
    for (const s of a.sides) {
      const e = by.get(s.faction) ?? { s: [], wins: [] };
      e.s.push(s);
      if (s.faction === a.winner) e.wins.push(a);
      by.set(s.faction, e);
    }
  }
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? mean(v) : null;
  };
  return [...by]
    .map(([faction, { s, wins }]) => {
      const big = wins.filter((a) => a.band === 'one-sided' || a.band === 'landslide');
      const why: SideTotals['why'] = {};
      for (const a of big) for (const r of a.reasons) why[r.kind] = (why[r.kind] ?? 0) + 1;
      const tp = s.filter((x) => x.teamplay);
      return {
        faction,
        rounds: s.length,
        wins: wins.length,
        bigWins: big.length,
        winCloseness: mean(wins.map((a) => a.closeness)),
        avgOn: mean(s.map((x) => x.avgOn)),
        kills: s.reduce((a, x) => a + x.kills, 0),
        deaths: s.reduce((a, x) => a + x.deaths, 0),
        headshots: s.reduce((a, x) => a + x.headshots, 0),
        kpm: mean(s.map((x) => x.kpm)),
        rating: avg(s.map((x) => x.rating)),
        expected: avg(s.map((x) => x.chance)),
        teamplay: tp.length ? { deaths: tp.reduce((a, x) => a + x.teamplay!.deaths, 0), refrags: tp.reduce((a, x) => a + x.teamplay!.refrags, 0) } : null,
        why,
      };
    })
    .sort((a, b) => b.wins - a.wins);
}
