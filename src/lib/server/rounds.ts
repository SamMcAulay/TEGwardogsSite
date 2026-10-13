// Round results to a Discord channel: every couple of minutes, rounds that have just ended are
// posted by the bot (over REST, no gateway), once each. The first run on a server records what has
// already ended without posting, so switching it on doesn't flood the channel.
import { mapName } from '@/lib/game';
import { plainName } from './accounts/interactions';
import type { Store } from './accounts/store';

/** Rounds that never had this many players (empty servers idling overnight) aren't posted. */
export const MIN_PEAK_PLAYERS = 10;
/** Rounds that ended longer ago than this are recorded but not posted (the site was down, say). */
export const MAX_AGE_S = 6 * 3600;

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
}

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
          { name: 'Length', value: duration(r.endedAt - r.startedAt), inline: true },
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
    if (firstSight.has(r.serverId) || r.peakPlayers < MIN_PEAK_PLAYERS || now - r.endedAt > MAX_AGE_S) {
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
    } catch (e) {
      console.error('[rounds] stopped; next pass retries:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  void run();
  g.__rounds = setInterval(() => void run(), intervalMs);
  g.__rounds.unref?.();
}
