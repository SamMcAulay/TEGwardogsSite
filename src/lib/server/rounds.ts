// Round results to a Discord channel: every couple of minutes, rounds that have just ended are
// posted by the bot (over REST, no gateway), once each, with the time actually played as their length. The first run on a server records what has
// already ended without posting, so switching it on doesn't flood the channel.
import { KOTH_CAP, mapName } from '@/lib/game';
import { plainName } from './accounts/interactions';
import type { Store } from './accounts/store';
import { jobRan } from './jobs';

/** Rounds that never had this many players (empty servers idling overnight) aren't posted. */
export const MIN_PEAK_PLAYERS = 10;
/** Rounds that ended longer ago than this are recorded but not posted (the site was down, say). */
export const MAX_AGE_S = 6 * 3600;
/** A round nobody won that scored fewer points than this in all was never really played (a restart, an empty map). */
export const MIN_POINTS = 20;
/** Population at or above this counts as the round being played. */
const PLAYING_AT = 2;

export interface EndedRound {
  serverId: string;
  serverName: string;
  matchId: number;
  map: string;
  startedAt: number;
  endedAt: number;
  peakPlayers: number;
  winner: string | null;
  scores: { name: string; score: number }[];
  /** seconds with people on (playedSeconds); null when the population history isn't to hand */
  playedSeconds?: number | null;
}

/**
 * How much of a round was played: its time with at least PLAYING_AT on, from population buckets.
 * Servers empty overnight with the round still open, so start-to-end can be 15 hours for one hour's
 * play. Time past the last bucket counts as played: the history lags, and a round ends with people on.
 */
export function playedSeconds(
  startedAt: number,
  endedAt: number,
  population: { ts: number; players: number }[],
  bucketSeconds: number,
): number | null {
  if (!population.length || bucketSeconds <= 0) return null;
  let played = 0;
  let covered = startedAt;
  for (const p of population) {
    const from = Math.max(p.ts, startedAt);
    const to = Math.min(p.ts + bucketSeconds, endedAt);
    if (to <= from) continue;
    if (p.players >= PLAYING_AT) played += to - from;
    covered = Math.max(covered, to);
  }
  return played + Math.max(0, endedAt - covered);
}

/** Whether anything happened: someone won, or the teams scored a fair few points between them. */
export const wasPlayed = (r: Pick<EndedRound, 'winner' | 'scores'>) =>
  r.scores.some((s) => s.score >= KOTH_CAP) || r.scores.reduce((a, s) => a + s.score, 0) >= MIN_POINTS;

export interface RoundDetail {
  colours: Record<string, string | null>;
  awards: { key: string; label: string; name: string; value: string }[];
}

// Discord can't read the CSS tokens: this mirrors --accent in globals.css.
const DEFAULT_COLOUR = 0xf2b33d;
const hex = (c: string | null | undefined) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? parseInt(c.replace('#', ''), 16) : DEFAULT_COLOUR);

function duration(s: number): string {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** The Discord message for one round. Every name in it is plain text. */
export function roundMessage(r: EndedRound, d: RoundDetail | null, siteUrl: string) {
  const map = mapName(r.map);
  const title = r.winner ? `${plainName(r.winner)} win on ${map}` : `Round over on ${map}`;
  const scores = [...r.scores].sort((a, b) => b.score - a.score).map((s) => `${plainName(s.name)} **${s.score}**`).join(' · ');
  const awards = (d?.awards ?? []).filter((a) => a.key !== 'cash').slice(0, 4);
  return {
    embeds: [
      {
        title,
        url: `${siteUrl}/matches/${r.serverId}/${r.matchId}`,
        description: scores || undefined,
        color: hex(r.winner ? d?.colours[r.winner] : null),
        fields: [
          ...awards.map((a) => ({ name: plainName(a.label), value: `${plainName(a.name)} · ${plainName(a.value)}`, inline: true })),
          { name: 'Length', value: duration(r.playedSeconds ?? r.endedAt - r.startedAt), inline: true },
          { name: 'Players', value: `${r.peakPlayers} at peak`, inline: true },
        ],
        footer: { text: plainName(r.serverName) },
        timestamp: new Date(r.endedAt * 1000).toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export interface AnnounceDeps {
  store: Store;
  siteUrl: string;
  /** recently ended rounds, any order */
  ended: () => Promise<EndedRound[]>;
  detail: (serverId: string, matchId: number) => Promise<RoundDetail | null>;
  /** posts one message; throws on failure */
  post: (body: object) => Promise<void>;
  nowSec?: number;
}

/** One pass: post each new round, oldest first; stop at the first failed post and retry next pass. */
export async function announceRounds(deps: AnnounceDeps): Promise<{ posted: number; skipped: number }> {
  const now = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const rounds = (await deps.ended()).sort((a, b) => a.endedAt - b.endedAt);
  const firstSight = new Set(rounds.map((r) => r.serverId).filter((id) => !deps.store.knowsServer(id)));
  let posted = 0;
  let skipped = 0;
  for (const r of rounds) {
    if (deps.store.isAnnounced(r.serverId, r.matchId)) continue;
    if (firstSight.has(r.serverId) || r.peakPlayers < MIN_PEAK_PLAYERS || now - r.endedAt > MAX_AGE_S || !wasPlayed(r)) {
      deps.store.markAnnounced(r.serverId, r.matchId);
      skipped++;
      continue;
    }
    const detail = await deps.detail(r.serverId, r.matchId).catch(() => null);
    await deps.post(roundMessage(r, detail, deps.siteUrl));
    deps.store.markAnnounced(r.serverId, r.matchId);
    posted++;
  }
  return { posted, skipped };
}

const API = (process.env.NODE_ENV !== 'production' && process.env.DISCORD_API_BASE) || 'https://discord.com/api/v10';

/** Posts a message as the bot in one channel. It needs View Channel, Send Messages and Embed Links there. */
export function botPoster(env: { discordBotToken: string; roundsChannelId: string }, f: typeof fetch = fetch) {
  return async (body: object) => {
    const res = await f(`${API}/channels/${env.roundsChannelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${env.discordBotToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 403 || res.status === 404) {
      throw new Error(`bot can't post in channel ${env.roundsChannelId} (${res.status}): allow it View Channel, Send Messages and Embed Links there`);
    }
    if (!res.ok) throw new Error(`posting the round failed (${res.status})`);
  };
}

const g = globalThis as unknown as { __rounds?: ReturnType<typeof setInterval> };

/** Start once per process: a pass now, then every intervalMs, never two at once. */
export function startRoundAnnouncer(deps: Omit<AnnounceDeps, 'nowSec'>, intervalMs = 2 * 60_000): void {
  if (g.__rounds) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await announceRounds(deps);
      if (r.posted) console.log(`[rounds] posted ${r.posted} round result(s)`);
      jobRan('rounds', { note: `posted ${r.posted}, skipped ${r.skipped}` });
    } catch (e) {
      console.error('[rounds] stopped; next pass retries:', e instanceof Error ? e.message : e);
      jobRan('rounds', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
  void run();
  g.__rounds = setInterval(() => void run(), intervalMs);
  g.__rounds.unref?.();
}
