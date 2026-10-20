// /notify alerts: a Discord DM when a server fills up or a map starts. A watcher reads the live
// server list once a minute (the warmer keeps it cached, so Warcon isn't asked again) and the bot
// DMs whoever asked. Members in the TEG server can be DMed by its bot unless they've closed DMs
// from server members; then their alerts pause until they set one again.
import { mapName } from '@/lib/game';
import type { AccountsEnv } from './accounts/env';
import type { Alert, Store } from './accounts/store';
import { jobRan } from './jobs';
import type { ServerRow } from './views';

/** Alerts one member may have at once. */
export const MAX_ALERTS = 5;
/** A players alert fires again only once the count has dropped this far below its threshold... */
export const REARM_GAP = 5;
/** ...and not within this long of the last DM. */
export const PLAYERS_COOLDOWN_S = 3 * 3600;
/** One map alert, at most once in this long (a quick restart onto the same map isn't news). */
export const MAP_COOLDOWN_S = 30 * 60;
/** DMs failing this many times in a row pause the member's alerts. */
export const ALERT_MAX_FAILURES = 3;

/** The maps a map alert can name (rotation names, as players know them). */
export const ALERT_MAPS = ['Bakurani', 'Ozeti', 'Zestafona'] as const;

type Live = Pick<ServerRow, 'id' | 'slug' | 'shortName' | 'online' | 'playerCount' | 'joinCode'> & { map: string | null };

export interface Due {
  alert: Alert;
  server: Live;
  text: string;
}

const joinLine = (s: Live, siteUrl: string) =>
  `${s.joinCode ? `Join code \`${s.joinCode}\` · ` : ''}<${siteUrl}/servers/${s.slug}>`;

/**
 * One pass over the alerts. `prevMaps` is each server's map at the last pass (none yet: a fresh
 * start, which records maps without firing). Returns the DMs to send and each alert's new state.
 */
export function evaluate(
  alerts: Alert[],
  servers: Live[],
  prevMaps: ReadonlyMap<string, string | null>,
  siteUrl: string,
  now: number,
): { due: Due[]; states: { id: number; armed: boolean; lastSent: number | null }[] } {
  const due: Due[] = [];
  const states: { id: number; armed: boolean; lastSent: number | null }[] = [];
  const up = servers.filter((s) => s.online);
  for (const a of alerts) {
    if (a.failures >= ALERT_MAX_FAILURES) continue;
    const pool = a.serverId ? up.filter((s) => s.id === a.serverId) : up;
    if (a.kind === 'players') {
      const busiest = [...pool].sort((x, y) => y.playerCount - x.playerCount)[0];
      const count = busiest?.playerCount ?? 0;
      if (a.armed && busiest && count >= a.threshold && (a.lastSent === null || now - a.lastSent >= PLAYERS_COOLDOWN_S)) {
        due.push({
          alert: a,
          server: busiest,
          text: `**${busiest.shortName}** has **${count} players** now (your alert: ${a.threshold}+).\n${joinLine(busiest, siteUrl)}`,
        });
        states.push({ id: a.id, armed: false, lastSent: now });
      } else if (!a.armed && count < a.threshold - REARM_GAP) {
        states.push({ id: a.id, armed: true, lastSent: a.lastSent });
      }
      continue;
    }
    if (a.lastSent !== null && now - a.lastSent < MAP_COOLDOWN_S) continue;
    const started = pool.find((s) => {
      if (!prevMaps.has(s.id) || !s.map) return false;
      const before = prevMaps.get(s.id);
      return before !== s.map && mapName(s.map) === a.map && s.playerCount >= a.threshold;
    });
    if (started) {
      due.push({
        alert: a,
        server: started,
        text: `**${a.map}** just started on **${started.shortName}**, ${started.playerCount} playing.\n${joinLine(started, siteUrl)}`,
      });
      states.push({ id: a.id, armed: true, lastSent: now });
    }
  }
  return { due, states };
}

/** What an alert asks for, in words: for /notify list and replies. */
export function describeAlert(a: Pick<Alert, 'kind' | 'serverId' | 'threshold' | 'map'>, serverName: (id: string) => string): string {
  const where = a.serverId ? serverName(a.serverId) : 'any server';
  return a.kind === 'players'
    ? `${where} reaches ${a.threshold} players`
    : `${a.map} starts on ${where}${a.threshold > 0 ? ` with ${a.threshold}+ playing` : ''}`;
}

const API = (process.env.NODE_ENV !== 'production' && process.env.DISCORD_API_BASE) || 'https://discord.com/api/v10';

export class DmRefused extends Error {}

/** Sends a DM as the bot. Throws DmRefused when Discord won't deliver to that member. */
export function dmSender(env: Pick<AccountsEnv, 'discordBotToken'>, f: typeof fetch = fetch) {
  const channels = new Map<string, string>();
  const call = (path: string, body: object) =>
    f(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${env.discordBotToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  return async (discordId: string, content: string) => {
    let channel = channels.get(discordId);
    if (!channel) {
      const res = await call('/users/@me/channels', { recipient_id: discordId });
      if (res.status === 400 || res.status === 403 || res.status === 404) throw new DmRefused(`can't open a DM (${res.status})`);
      if (!res.ok) throw new Error(`opening a DM failed (${res.status})`);
      channel = String(((await res.json()) as { id?: string }).id ?? '');
      if (!channel) throw new Error('opening a DM returned no channel');
      channels.set(discordId, channel);
    }
    const res = await call(`/channels/${channel}/messages`, { content, allowed_mentions: { parse: [] } });
    // 50007: Cannot send messages to this user (DMs closed, or they left the server)
    if (res.status === 403) throw new DmRefused('DMs closed');
    if (!res.ok) throw new Error(`sending a DM failed (${res.status})`);
  };
}

const shared = globalThis as unknown as { __dmSender?: ReturnType<typeof dmSender> };

/** One sender per process, so the watcher and /notify share its cache of DM channels. */
export const botDms = (env: Pick<AccountsEnv, 'discordBotToken'>) => (shared.__dmSender ??= dmSender(env));

/**
 * After /notify sets an alert: DM the member now, so they find out at once if DMs can't reach them
 * (a private follow-up on their command says so) rather than when the server fills up.
 */
export function alertConfirmer(env: Pick<AccountsEnv, 'discordBotToken' | 'discordClientId'>, send = botDms(env), f: typeof fetch = fetch) {
  return (discordId: string, interactionToken: string, text: string) => {
    void send(discordId, text).catch(async (e) => {
      if (!(e instanceof DmRefused)) return console.error('[alerts] confirmation DM failed:', e instanceof Error ? e.message : e);
      await f(`${API}/webhooks/${env.discordClientId}/${interactionToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: "I couldn't DM you, so this alert won't reach you. In the TEG server's Privacy Settings, allow Direct Messages, then set the alert again.",
          flags: 64,
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    });
  };
}

export interface WatchDeps {
  store: Store;
  siteUrl: string;
  servers: () => Promise<ServerRow[]>;
  send: (discordId: string, content: string) => Promise<void>;
}

/** One pass: evaluate every alert, save the new states, send the DMs. Returns the next prevMaps. */
export async function alertPass(deps: WatchDeps, prevMaps: ReadonlyMap<string, string | null>, now = Math.floor(Date.now() / 1000)) {
  const servers: Live[] = (await deps.servers()).map((s) => ({ ...s, map: s.status?.map ?? null }));
  const { due, states } = evaluate(deps.store.allAlerts(), servers, prevMaps, deps.siteUrl, now);
  for (const st of states) deps.store.setAlertState(st.id, st.armed, st.lastSent);
  let sent = 0;
  let failed = 0;
  for (const d of due) {
    try {
      await deps.send(d.alert.discordId, d.text);
      if (d.alert.failures) deps.store.setAlertFailures(d.alert.discordId, 0);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof DmRefused) deps.store.setAlertFailures(d.alert.discordId, d.alert.failures + 1);
      else console.error('[alerts] DM failed:', e instanceof Error ? e.message : e);
    }
  }
  // A server Warcon didn't answer for keeps its last known map, so it can't look like a change.
  const next = new Map(prevMaps);
  for (const s of servers) if (s.online !== null) next.set(s.id, s.map);
  return { next, sent, failed };
}

const g = globalThis as unknown as { __alerts?: ReturnType<typeof setInterval> };

/** Start once per process: a pass now, then every intervalMs, never two at once. */
export function startAlertWatcher(deps: WatchDeps, intervalMs = 60_000): void {
  if (g.__alerts) return;
  let prev: ReadonlyMap<string, string | null> = new Map();
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await alertPass(deps, prev);
      prev = r.next;
      jobRan('alerts', { note: `sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ''}` });
    } catch (e) {
      console.error('[alerts] pass failed; next one retries:', e instanceof Error ? e.message : e);
      jobRan('alerts', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
  void run();
  g.__alerts = setInterval(() => void run(), intervalMs);
  g.__alerts.unref?.();
}
