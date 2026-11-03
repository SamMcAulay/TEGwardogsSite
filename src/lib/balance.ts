// Match balance for staff (/admin/balance): how close each round was, how the sides compared on
// numbers, skill, gunfights and teamwork, and a best guess at why it went the way it did.
// Pure; the rounds come from history.db, refrags from each round's kill feed.

/** A death is traded (refragged) when a teammate kills the killer within this many seconds. */
export const REFRAG_SECONDS = 20;

/** One side's teamwork in a round: deaths to the enemy, and how many of those were traded. */
export interface Teamplay {
  deaths: number;
  traded: number;
}

interface FeedKill {
  eventTime: number;
  killer: { steamId: string; faction: string | null } | null;
  victim: { steamId: string; faction: string | null };
  teamKill: boolean;
  suicide: boolean;
}

/**
 * Each faction's traded deaths in a round: X dies to K, and within REFRAG_SECONDS a teammate of X
 * kills K. One avenging kill trades every teammate K had just killed, so traded / deaths is a
 * true share of deaths.
 */
export function refrags(kills: FeedKill[]): Record<string, Teamplay> {
  const out: Record<string, Teamplay> = {};
  const side = (f: string) => (out[f] ??= { deaths: 0, traded: 0 });
  // deaths still waiting to be traded: who killed whom, when
  let open: { t: number; killer: string; faction: string }[] = [];
  for (const k of [...kills].sort((a, b) => a.eventTime - b.eventTime)) {
    if (!k.killer || k.teamKill || k.suicide || !k.killer.faction || !k.victim.faction) continue;
    const t = k.eventTime;
    open = open.filter((d) => t - d.t <= REFRAG_SECONDS);
    const avenged = open.filter((d) => d.killer === k.victim.steamId && d.faction === k.killer!.faction);
    if (avenged.length) {
      side(k.killer.faction).traded += avenged.length;
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
export const bandLabel = (b: Band) => BANDS.find((x) => x.band === b)!.label;
/** Badge tone per band (components/ui Badge). */
export const BAND_TONE = { close: 'good', fair: 'default', 'one-sided': 'accent', landslide: 'bad' } as const satisfies Record<Band, string>;

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
  /** share of the side's kills made by its three best killers: high means a few carried it */
  top3: number;
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
export const tradeRate = (t: Teamplay | null) => (t && t.deaths ? t.traded / t.deaths : null);

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
      top3: lines.map((l) => l.kills).sort((a, b) => b - a).slice(0, 3).reduce((a, k) => a + k, 0) / Math.max(1, sum('kills')),
      rating: p?.rating ?? null,
      chance: p?.chance ?? null,
      // A side missing from the record (or {}: the feed was empty) wasn't measured, not zero.
      teamplay: round.teamplay?.[name] ?? null,
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
  // An upset already says the sides weren't even; claiming they were would contradict it.
  if (!out.length) {
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
  /** top-3 kill share, averaged over the rounds they won and the rounds they lost */
  carryWon: number | null;
  carryLost: number | null;
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
        teamplay: tp.length ? { deaths: tp.reduce((a, x) => a + x.teamplay!.deaths, 0), traded: tp.reduce((a, x) => a + x.teamplay!.traded, 0) } : null,
        why,
        carryWon: avg(s.filter((x) => wins.some((a) => a.sides.includes(x))).map((x) => x.top3)),
        carryLost: avg(s.filter((x) => !wins.some((a) => a.sides.includes(x))).map((x) => x.top3)),
      };
    })
    .sort((a, b) => b.wins - a.wins);
}

export interface Split {
  key: string;
  rounds: number;
  wins: Record<string, number>;
  /** one-sided or landslide rounds */
  big: number;
  closeness: number;
}

/** Analysed rounds grouped by any key (map, day, hour), in first-seen order unless sorted after. */
export function splitBy(items: { key: string; a: Analysed }[]): Split[] {
  const by = new Map<string, Analysed[]>();
  for (const { key, a } of items) by.set(key, [...(by.get(key) ?? []), a]);
  return [...by].map(([key, list]) => {
    const wins: Record<string, number> = {};
    for (const a of list) wins[a.winner] = (wins[a.winner] ?? 0) + 1;
    return {
      key,
      rounds: list.length,
      wins,
      big: list.filter((a) => a.band === 'one-sided' || a.band === 'landslide').length,
      closeness: mean(list.map((a) => a.closeness)),
    };
  });
}

export interface Loyalty {
  steamId: string;
  rounds: number;
  /** rounds on each side */
  sides: Record<string, number>;
  /** the side they played most, and the share of their rounds on it */
  faction: string;
  share: number;
}

/** Each player's rounds per side (2 minutes or more on), most rounds first. */
export function loyalty(rounds: { lines: { steamId: string; faction: string | null; seconds: number }[] }[]): Loyalty[] {
  const by = new Map<string, Record<string, number>>();
  for (const r of rounds) {
    for (const l of r.lines) {
      if (!l.faction || l.seconds < 120) continue;
      const sides = by.get(l.steamId) ?? {};
      sides[l.faction] = (sides[l.faction] ?? 0) + 1;
      by.set(l.steamId, sides);
    }
  }
  return [...by]
    .map(([steamId, sides]) => {
      const n = Object.values(sides).reduce((a, x) => a + x, 0);
      const [faction, most] = Object.entries(sides).sort((a, b) => b[1] - a[1])[0];
      return { steamId, rounds: n, sides, faction, share: most / n };
    })
    .sort((a, b) => b.rounds - a.rounds);
}

/** Players grouped by clan tag: their rounds per side added up. Tags seen on fewer than `minMembers` are left out. */
export function clanSides(players: Loyalty[], tagOf: (steamId: string) => string | null, minMembers = 3) {
  const by = new Map<string, { tag: string; members: number; rounds: number; sides: Record<string, number> }>();
  for (const p of players) {
    const tag = tagOf(p.steamId);
    if (!tag) continue;
    const c = by.get(tag) ?? { tag, members: 0, rounds: 0, sides: {} };
    c.members++;
    c.rounds += p.rounds;
    for (const [f, n] of Object.entries(p.sides)) c.sides[f] = (c.sides[f] ?? 0) + n;
    by.set(tag, c);
  }
  return [...by.values()].filter((c) => c.members >= minMembers).sort((a, b) => b.rounds - a.rounds);
}

export interface Calibration {
  /** favourite's chance going in: from (inclusive) to (exclusive) */
  from: number;
  to: number;
  rounds: number;
  /** what the ratings said, averaged, and how often the favourite really won */
  predicted: number;
  won: number;
}

const CALIBRATION_EDGES = [0, 0.4, 0.5, 0.6, 0.7, 1.01];

/**
 * Do the ratings pick winners? Rounds grouped by the favourite's chance going in. Well-calibrated
 * ratings win about as often as they predict in every group; empty groups are left out.
 */
export function calibration(rounds: Analysed[]): Calibration[] {
  const out = CALIBRATION_EDGES.slice(1).map((to, i) => ({ from: CALIBRATION_EDGES[i], to, rounds: 0, predicted: 0, won: 0 }));
  for (const a of rounds) {
    if (a.sides.some((s) => s.chance == null)) continue;
    const fav = a.sides.reduce((x, s) => (s.chance! > x.chance! ? s : x));
    const b = out.find((g) => fav.chance! >= g.from && fav.chance! < g.to)!;
    b.rounds++;
    b.predicted += fav.chance!;
    if (fav.faction === a.winner) b.won++;
  }
  return out.filter((g) => g.rounds).map((g) => ({ ...g, predicted: g.predicted / g.rounds, won: g.won / g.rounds }));
}
