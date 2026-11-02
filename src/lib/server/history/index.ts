// Keeps history.db filled from Warcon (lib/server/history/ingest.ts) and serves the ratings worked
// out from it. The job runs every 5 minutes: new rounds, then today's board snapshot if not taken.
import { refrags } from '@/lib/balance';
import { displayRating, fresh } from '@/lib/rating';
import type { WKill } from '../warcon/schemas';
import { jobRan } from '../jobs';
import { SEASON_TWO_START } from '../seasons';
import { warcon } from '../warcon';
import { ingestRounds, snapshotToday, type RoundSource } from './ingest';
import { buildRatings, RATED_MIN_PEAK, sideStrength, type PlayerRating } from './ratings';
import { history, type BoardTotals } from './store';

const sec = (iso: string | null | undefined): number | null => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

/** Rounds from Warcon: its match list pages, and each finished match's view. */
export const warconRounds: RoundSource = {
  async page(serverId, page) {
    const { value } = await warcon().matches(serverId, page);
    return { rounds: value.matches.map((m) => ({ id: m.id, startedAt: sec(m.startedAt)!, endedAt: sec(m.endedAt) })), pages: value.pages };
  },
  async round(serverId, matchId) {
    const v = (await warcon().match(serverId, matchId)).value;
    return {
      round: {
        serverId,
        matchId,
        startedAt: sec(v.match.startedAt)!,
        endedAt: sec(v.match.endedAt)!,
        map: v.match.map,
        lighting: v.match.lighting,
        winner: v.match.winner,
        peak: v.match.peakPlayers,
        scores: (v.match.finalScores ?? []).map((f) => ({ name: f.name, score: f.score })),
      },
      lines: v.lines.map((l) => ({
        steamId: l.steamId,
        faction: l.faction,
        seconds: l.seconds,
        kills: l.kills,
        deaths: l.deaths,
        headshots: l.headshots,
        result: l.result,
      })),
    };
  },
};

const g = globalThis as unknown as {
  __historyJob?: ReturnType<typeof setInterval>;
  __ratings?: { rounds: number; ratings: Map<string, PlayerRating> };
  __pre?: { rounds: number; pre: Map<string, PreRound> };
};

/** Each side's average rating and chance of winning as a rated round started. */
export type PreRound = { faction: string; rating: number; chance: number }[];

/** Rounds whose kill feed is read for refrags per pass: older rounds fill in over a few hours. */
const TEAMPLAY_PER_PASS = 20;
/** A round's kill feed is read this long after it ends, so its last kills have landed. */
const TEAMPLAY_SETTLE_S = 600;

/** Everyone's season-two rating; null when history.db isn't available. Rebuilt when rounds are added. */
export function ratings(): Map<string, PlayerRating> | null {
  const h = history();
  if (!h) return null;
  const n = h.roundCount();
  if (g.__ratings?.rounds !== n) g.__ratings = { rounds: n, ratings: buildRatings(h.rounds(SEASON_TWO_START)) };
  return g.__ratings.ratings;
}

/** Every season-two rated round's sides as it started, by "serverId:matchId"; null without history.db. */
export function preRounds(): Map<string, PreRound> | null {
  const h = history();
  if (!h) return null;
  const n = h.roundCount();
  if (g.__pre?.rounds !== n) {
    const pre = new Map<string, PreRound>();
    const newcomer = displayRating(fresh());
    buildRatings(h.rounds(SEASON_TWO_START), (round, teams, players) => {
      const odds = sideStrength(teams, players);
      pre.set(
        `${round.serverId}:${round.matchId}`,
        teams.map((t, i) => ({
          faction: t.faction,
          rating: t.steamIds.reduce((a, id) => a + (players.get(id)?.rating ?? newcomer), 0) / Math.max(1, t.steamIds.length),
          chance: odds[i].chance,
        })),
      );
    });
    g.__pre = { rounds: n, pre };
  }
  return g.__pre.pre;
}

async function pass(deps: {
  serverIds: () => Promise<string[]>;
  board: () => Promise<{ steamId: string; totals: BoardTotals }[]>;
  kills?: (serverId: string, matchId: number) => Promise<WKill[]>;
}) {
  const h = history();
  if (!h) return jobRan('history', { error: 'history.db could not be opened' });
  const errors: string[] = [];
  let added = 0;
  let snap: number | null = null;
  try {
    const r = await ingestRounds(h, warconRounds, await deps.serverIds(), SEASON_TWO_START);
    added = r.added;
    errors.push(...r.errors);
  } catch (e) {
    errors.push(`rounds: ${e instanceof Error ? e.message : e}`);
  }
  try {
    snap = await snapshotToday(h, deps.board);
  } catch (e) {
    errors.push(`snapshot: ${e instanceof Error ? e.message : e}`);
  }
  let traded = 0;
  if (deps.kills) {
    try {
      for (const r of h.needTeamplay(RATED_MIN_PEAK, Math.floor(Date.now() / 1000) - TEAMPLAY_SETTLE_S, TEAMPLAY_PER_PASS)) {
        h.setTeamplay(r.serverId, r.matchId, refrags(await deps.kills(r.serverId, r.matchId)));
        traded++;
      }
    } catch (e) {
      errors.push(`refrags: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Rate the new rounds now, not on the next visitor's page load.
  if (added) ratings();
  jobRan('history', {
    error: errors.length ? errors.join('; ') : null,
    note: `${added} new round${added === 1 ? '' : 's'}, ${h.roundCount()} stored, ${traded} read for refrags${snap != null ? `; snapshot of ${snap} changed players` : ''}`,
  });
}

/** Starts the history job (once per process). */
export function startHistory(deps: Parameters<typeof pass>[0], intervalMs = 5 * 60_000): void {
  if (g.__historyJob) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pass(deps);
    } finally {
      running = false;
    }
  };
  void run();
  g.__historyJob = setInterval(() => void run(), intervalMs);
  g.__historyJob.unref?.();
}
