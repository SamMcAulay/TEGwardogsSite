// Fills history.db: every finished round since season two began, read once from Warcon (newest
// first, so a backlog fills in over a few passes without a burst), and the all-time board once a
// UTC day.
import type { BoardTotals, History, StoredLine, StoredRound } from './store';

export interface RoundSource {
  /** one page of a server's rounds, newest first */
  page(serverId: string, page: number): Promise<{ rounds: { id: number; startedAt: number; endedAt: number | null }[]; pages: number }>;
  /** one finished round with everyone's line */
  round(serverId: string, matchId: number): Promise<{ round: StoredRound; lines: StoredLine[] }>;
}

/** Match views read per pass at most: a backlog fills over several passes, gently on Warcon. */
export const ROUNDS_PER_PASS = 60;

const completeKey = (serverId: string) => `backfilled:${serverId}`;

/**
 * Reads rounds this store hasn't got. Until a server's backlog back to `since` is in, each pass
 * walks its pages to `since`; after that, only until a page with nothing new. Stops after `limit`
 * new rounds in all. Returns how many it added.
 */
export async function ingestRounds(
  h: History,
  src: RoundSource,
  serverIds: string[],
  since: number,
  limit = ROUNDS_PER_PASS,
): Promise<{ added: number; errors: string[] }> {
  let added = 0;
  const errors: string[] = [];
  for (const serverId of serverIds) {
    const complete = h.meta(completeKey(serverId)) === '1';
    let reachedStart = false;
    let budgetLeft = true;
    try {
      for (let page = 1; ; page++) {
        const { rounds, pages } = await src.page(serverId, page);
        let fresh = 0;
        for (const r of rounds) {
          if (r.startedAt < since) {
            reachedStart = true;
            break;
          }
          if (r.endedAt == null || h.hasRound(serverId, r.id)) continue;
          if (added >= limit) {
            budgetLeft = false;
            break;
          }
          const { round, lines } = await src.round(serverId, r.id);
          h.addRound(round, lines);
          added++;
          fresh++;
        }
        if (reachedStart || !budgetLeft || page >= pages || !rounds.length) {
          if (!rounds.length || page >= pages) reachedStart = true;
          break;
        }
        if (complete && !fresh) break;
      }
      if (reachedStart && budgetLeft && !complete) h.setMeta(completeKey(serverId), '1');
    } catch (e) {
      errors.push(`${serverId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { added, errors };
}

/** The UTC day a time falls on, YYYY-MM-DD. */
export const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Takes today's board snapshot if it hasn't been taken. Returns the rows written, or null if already done. */
export async function snapshotToday(
  h: History,
  board: () => Promise<{ steamId: string; totals: BoardTotals }[]>,
  now = Math.floor(Date.now() / 1000),
): Promise<number | null> {
  const day = utcDay(now);
  if (h.hasSnapshot(day)) return null;
  const rows = await board();
  if (!rows.length) throw new Error('the board export was empty');
  return h.saveSnapshot(day, rows, now);
}
