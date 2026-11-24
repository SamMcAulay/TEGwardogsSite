// What the home page's broadcast feed shows besides the live servers: the round so far, the last
// result, what's up next, the longest shot, today's top dog and their nearest milestone. Every piece
// is fetched on its own and drops out (null) on failure, so one bad call loses one segment.
import { mapName, ROTATION, roundEta, rotationStarts, typicalRound } from '@/lib/game';
import { milestones, type MilestoneTotals } from '@/lib/milestones';
import { turningPoints } from '@/lib/replay';
import { classKills } from '@/lib/weapon-classes';
import { accounts } from './accounts';
import { getPlayer, listMatches } from './data';
import { entryOf } from './rotation/pool';
import { warcon } from './warcon';
import type { MatchRow, RecordRow, RecordShot, ServerRow } from './views';

export interface UpNext {
  map: string;
  lighting: string | null;
  /** seconds from now until it starts; null when nobody can say */
  inSeconds: number | null;
}

export interface Turn {
  /** seconds into the round */
  t: number;
  faction: string;
  kind: 'lead' | 'retake';
}

export interface RoundStory {
  serverId: string;
  serverName: string;
  map: string;
  lighting: string | null;
  factions: string[];
  /** [seconds in, score per faction...] */
  timeline: number[][];
  /** seconds the round has run (live) or lasted (finished) */
  length: number;
  turns: Turn[];
  scores: { name: string; score: number }[];
}

export interface HomeFeed {
  upNext: Record<string, UpNext[]>;
  /** seconds into each server's round; null when nobody is playing it or it can't be told */
  clock: Record<string, number | null>;
  /** the busiest live round, as it stands */
  roundSoFar: RoundStory | null;
  /** the most recently finished round on any server */
  lastResult: RoundStory | null;
  longest: { shot: RecordShot; today: boolean } | null;
  topToday: RecordRow | null;
  milestone: { steamId: string; name: string; avatarUrl: string | null; label: string; value: number; next: number; badge: string } | null;
}

/** A round somebody actually scored in; empty servers end rounds at 0–0–0. */
export const scored = (scores: { score: number }[]) => scores.some((x) => x.score > 0);

const quiet = <T>(p: Promise<T>): Promise<T | null> =>
  p.catch((e) => {
    console.error('[feed]', e instanceof Error ? e.message : e);
    return null;
  });

/** The longest shot of the last 24 hours, else the longest on record. */
export function pickLongest(shots: RecordShot[], now: number): HomeFeed['longest'] {
  const today = shots.filter((s) => s.ts >= now - 86_400).sort((a, b) => b.distance - a.distance)[0];
  if (today) return { shot: today, today: true };
  const best = [...shots].sort((a, b) => b.distance - a.distance)[0];
  return best ? { shot: best, today: false } : null;
}

/** The career track a player is closest to finishing, as a share of the way to its next badge. */
export function nearestMilestone(t: MilestoneTotals): { label: string; value: number; next: number; badge: string } | null {
  const open = milestones(t).filter((m) => m.group === 'career' && m.next && m.value > 0);
  const best = open.sort((a, b) => b.value / b.next!.at - a.value / a.next!.at)[0];
  return best ? { label: best.label, value: best.value, next: best.next!.at, badge: best.next!.badge } : null;
}

/** The moments the lead changed, named by faction. */
export function turnsOf(timeline: number[][], factions: string[]): Turn[] {
  return turningPoints(timeline, factions.length).map((p) => ({ t: p.t, faction: factions[p.faction], kind: p.kind }));
}

/**
 * The next three maps on a server with when each should start: the weighted plan when staff run one,
 * else the fixed rotation. Times follow the server page: the round in progress ends on its score
 * pace (or a typical round's length), and each later map runs a typical round.
 */
/** Seconds into a server's round: the server's own clock, else since its open match started. An empty
 *  server's round sits open for hours with nobody scoring, so that has no clock. */
export function roundClock(server: ServerRow, matches: MatchRow[], now: number): number | null {
  const st = server.status;
  if (!st || (server.playerCount === 0 && st.factionScores.every((f) => f.score === 0))) return null;
  const live = matches.find((m) => m.endedAt == null);
  return st.matchSeconds ?? (live ? now - live.startedAt : null);
}

export function upNextOf(server: ServerRow, matches: MatchRow[], now: number): UpNext[] {
  const st = server.status;
  if (!st) return [];
  const waiting = server.playerCount === 0 && st.factionScores.every((f) => f.score === 0);
  const elapsed = roundClock(server, matches, now);
  const eta = roundEta(st.factionScores.map((f) => f.score), st.scoreTick, st.scoreCap);
  const roundLength = typicalRound(matches);
  const untilNext = waiting ? null : (eta ?? (elapsed != null && roundLength ? Math.max(0, roundLength - elapsed) : null));
  const at = (ahead: number) => (untilNext == null ? null : ahead === 1 ? untilNext : roundLength ? untilNext + (ahead - 1) * roundLength : null);

  const weighted = accounts()?.store.rotationServer(server.id);
  if (weighted?.enabled && weighted.nextKey) {
    return [weighted.nextKey, ...weighted.later]
      .map((k) => entryOf(...(k.split('/') as [string, string])))
      .filter((e) => e != null)
      .slice(0, 3)
      .map((e, i) => ({ map: e.map, lighting: e.lighting, inSeconds: at(i + 1) }));
  }
  const n = ROTATION.length;
  const slot = st.rotation.now;
  if (slot == null || slot < 0 || !n) return [];
  const starts = rotationStarts(slot, n, untilNext, roundLength);
  return [1, 2, 3].map((ahead) => {
    const i = (slot + ahead) % n;
    return { map: ROTATION[i].map, lighting: ROTATION[i].lighting, inSeconds: starts?.[i] ?? null };
  });
}

async function story(server: { id: string; shortName: string }, row: MatchRow, now: number): Promise<RoundStory | null> {
  const v = (await warcon().match(server.id, row.id)).value;
  if (!v.timeline.length) return null;
  const factions = v.factions.map((f) => f.name);
  const end = row.endedAt ?? now;
  return {
    serverId: server.id,
    serverName: server.shortName,
    map: mapName(row.map),
    lighting: row.lighting,
    factions,
    timeline: v.timeline,
    length: Math.max(v.timeline.at(-1)?.[0] ?? 0, end - row.startedAt),
    turns: turnsOf(v.timeline, factions),
    scores: row.scores.map((s) => ({ name: s.name, score: s.score })),
  };
}

export async function homeFeed(servers: ServerRow[], recs: { longestShots: RecordShot[]; today: RecordRow[] } | null): Promise<HomeFeed> {
  const now = Math.floor(Date.now() / 1000);
  const lists = await Promise.all(servers.map((s) => quiet(listMatches({ serverId: s.id, limit: 20 }).then((r) => r.data.rows))));
  const upNext = Object.fromEntries(servers.map((s, i) => [s.id, upNextOf(s, lists[i] ?? [], now)]));
  const clock = Object.fromEntries(servers.map((s, i) => [s.id, roundClock(s, lists[i] ?? [], now)]));

  // The busiest server with a round actually being played.
  const busiest = servers
    .map((s, i) => ({ s, live: lists[i]?.find((m) => m.endedAt == null) }))
    .filter((x) => x.s.online && x.s.playerCount > 0 && x.live)
    .sort((a, b) => b.s.playerCount - a.s.playerCount)[0];
  const last = servers
    .flatMap((s, i) => (lists[i] ?? []).filter((m) => m.endedAt != null && scored(m.scores)).map((m) => ({ s, m })))
    .sort((a, b) => b.m.endedAt! - a.m.endedAt!)[0];

  const topToday = recs?.today[0] ?? null;
  const [roundSoFar, lastResult, player] = await Promise.all([
    busiest ? quiet(story(busiest.s, busiest.live!, now)) : null,
    last ? quiet(story(last.s, last.m, now)) : null,
    topToday ? quiet(getPlayer(topToday.steamId)) : null,
  ]);
  const p = player?.data;
  const near = p ? nearestMilestone({ ...p.totals, classKills: classKills(p.weapons) }) : null;

  return {
    upNext,
    clock,
    roundSoFar,
    lastResult,
    longest: recs ? pickLongest(recs.longestShots, now) : null,
    topToday,
    milestone: p && near ? { steamId: p.steamId, name: p.name, avatarUrl: p.avatarUrl, ...near } : null,
  };
}
