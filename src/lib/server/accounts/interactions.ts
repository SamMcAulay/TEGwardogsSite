// Discord slash commands over HTTP: Discord POSTs each use of a command to
// /api/discord/interactions and shows our JSON reply. No gateway connection, no bot process.
// /lookup (staff: a member's linked stats profile, in the channel), /link (anyone: how to link,
// or what they're linked to, privately) and /notify (anyone: DM alerts when a server fills up or a
// map starts, privately).
import { createPublicKey, verify } from 'node:crypto';
import { ALERT_MAPS, ALERT_MAX_FAILURES, describeAlert, MAX_ALERTS } from '../alerts';
import type { AccountsEnv } from './env';
import type { Store } from './store';

const API = (process.env.NODE_ENV !== 'production' && process.env.DISCORD_API_BASE) || 'https://discord.com/api/v10';
/** Discord's calls older than this are refused, so a captured one can't be replayed later. */
const MAX_AGE_S = 5 * 60;
const EPHEMERAL = 64;
/** Discord gives up after 3 s; a player name that takes longer than this is left out of the reply. */
export const NAME_BUDGET_MS = 1500;

const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((done) => setTimeout(() => done(fallback), ms).unref?.())]);

/** True when Discord signed `timestamp + body` with the application's key, recently. */
export function verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex) || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSec - Number(timestamp)) > MAX_AGE_S) return false;
  try {
    // An Ed25519 public key as DER: fixed SPKI prefix + the 32 raw bytes.
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/** A server as /notify offers it. */
export interface NotifyServer {
  id: string;
  shortName: string;
  slug: string;
}

/** /notify's subcommands; `servers` become the server option's choices (Discord allows 25). */
export function notifyCommand(servers: NotifyServer[]) {
  const server = {
    type: 3,
    name: 'server',
    description: 'Which server (leave out for any)',
    required: false,
    ...(servers.length ? { choices: servers.slice(0, 25).map((s) => ({ name: s.shortName, value: s.id })) } : {}),
  };
  return {
    name: 'notify',
    description: 'Get a DM when a WARDOGS server fills up or a map starts',
    type: 1,
    contexts: [0],
    options: [
      {
        type: 1,
        name: 'players',
        description: 'DM me when a server reaches a number of players',
        options: [{ type: 4, name: 'count', description: 'Players (5 to 100)', required: true, min_value: 5, max_value: 100 }, server],
      },
      {
        type: 1,
        name: 'map',
        description: 'DM me when a map starts',
        options: [
          { type: 3, name: 'map', description: 'Which map', required: true, choices: ALERT_MAPS.map((m) => ({ name: m, value: m })) },
          server,
          { type: 4, name: 'min_players', description: 'Only if at least this many are playing (default 10)', required: false, min_value: 0, max_value: 100 },
        ],
      },
      { type: 1, name: 'list', description: 'Show my alerts' },
      {
        type: 1,
        name: 'stop',
        description: 'Stop one alert, or all of them',
        options: [{ type: 4, name: 'id', description: 'The alert number from /notify list (leave out for all)', required: false, min_value: 1 }],
      },
    ],
  };
}

/** The commands the site registers in the TEG server. */
export const COMMANDS = [
  {
    name: 'lookup',
    description: "Staff: a member's WARDOGS stats profile",
    type: 1,
    contexts: [0],
    options: [{ type: 6, name: 'member', description: 'The Discord member to look up', required: true }],
  },
  {
    name: 'link',
    description: 'Link your Discord and Steam accounts for your TEG status and queue priority',
    type: 1,
    contexts: [0],
  },
];

/** Replaces the guild's commands with COMMANDS and /notify (idempotent; safe on every start). */
export async function registerCommands(env: AccountsEnv, f: typeof fetch = fetch, servers: NotifyServer[] = []): Promise<void> {
  const res = await f(`${API}/applications/${env.discordClientId}/guilds/${env.discordGuildId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${env.discordBotToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([...COMMANDS, notifyCommand(servers)]),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`registering slash commands failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

interface Option {
  name: string;
  value?: unknown;
  options?: Option[];
}

interface Interaction {
  type: number;
  guild_id?: string;
  /** for follow-up messages, valid 15 minutes */
  token?: string;
  member?: { roles?: string[]; user?: { id?: string } };
  data?: {
    name?: string;
    options?: Option[];
    resolved?: { users?: Record<string, { username?: string; global_name?: string | null }>; members?: Record<string, { nick?: string | null }> };
  };
}

/**
 * A member-chosen name (Discord nickname, Steam name) as plain text in a bot message: Discord
 * renders bot messages as markdown, so a name like `[Free Nitro](https://…)` would otherwise post
 * a disguised link under the bot's name. One line, at most 64 characters, formatting escaped,
 * and any `://` broken with a zero-width space so it can't become a link.
 */
export function plainName(name: string): string {
  const oneLine = name.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  const short = [...oneLine].length > 64 ? `${[...oneLine].slice(0, 63).join('')}…` : oneLine;
  return short.replace(/[\\*_~`|>[\]()#<]/g, (c) => `\\${c}`).replace(/:\/\//g, ':/\u200b/');
}

/** A reply in the channel, or `privately` only to whoever ran the command. Never pings anyone. */
const say = (content: string, privately = false) => ({
  type: 4,
  data: { content, ...(privately ? { flags: EPHEMERAL } : {}), allowed_mentions: { parse: [] } },
});

/** The reply to one verified interaction. */
export async function handleInteraction(
  i: Interaction,
  deps: {
    env: AccountsEnv;
    store: Store;
    siteUrl: string;
    playerName: (steamId: string) => Promise<string | null>;
    nameBudgetMs?: number;
    /** the servers /notify can name; quick (cached) */
    servers?: () => Promise<NotifyServer[]>;
    /** after a new alert: DM the member to check DMs reach them, and tell them if not. Not awaited. */
    confirmAlert?: (discordId: string, interactionToken: string, text: string) => void;
  },
): Promise<object> {
  if (i.type === 1) return { type: 1 }; // PING: Discord checking the endpoint
  if (i.type === 2 && i.data?.name === 'link') return linkCommand(i, deps);
  if (i.type === 2 && i.data?.name === 'notify') return notifyCommandReply(i, deps);
  if (i.type !== 2 || i.data?.name !== 'lookup') return say('Unknown command.', true);
  const { env, store, siteUrl } = deps;
  const roles = i.member?.roles ?? [];
  if (i.guild_id !== env.discordGuildId || !env.roles.staff.some((r) => roles.includes(r))) {
    return say('This command is for TEG staff only.', true);
  }
  const id = String(i.data.options?.find((o) => o.name === 'member')?.value ?? '');
  if (!/^\d{17,20}$/.test(id)) return say('Pick a member to look up.', true);
  const user = i.data.resolved?.users?.[id];
  const who = plainName(i.data.resolved?.members?.[id]?.nick || user?.global_name || user?.username || 'That member');
  const link = store.byDiscord(id);
  if (!link) return say(`**${who}** hasn't linked their Steam account. They can link it at <${siteUrl}/account>: sign in with Discord, then Steam.`);
  const found = await within(deps.playerName(link.steamId), deps.nameBudgetMs ?? NAME_BUDGET_MS, null);
  const name = found && plainName(found);
  return say(`**${who}**${name ? ` plays as **${name}**` : ''}: ${siteUrl}/players/${link.steamId}`);
}

/** /link: private to whoever ran it. Not linked: how to. Linked: which player, and where to change it. */
async function linkCommand(i: Interaction, deps: Parameters<typeof handleInteraction>[1]): Promise<object> {
  const { store, siteUrl } = deps;
  const id = i.member?.user?.id ?? '';
  const link = /^\d{17,20}$/.test(id) ? store.byDiscord(id) : null;
  if (!link) {
    return say(
      `Link your Discord and Steam accounts at <${siteUrl}/account>: sign in with Discord, then Steam. ` +
        'It takes a minute, shows your TEG status on your stats profile, and gets you queue priority once tiered queues arrive.',
      true,
    );
  }
  const found = await within(deps.playerName(link.steamId), deps.nameBudgetMs ?? NAME_BUDGET_MS, null);
  const name = found ? ` as **${plainName(found)}**` : '';
  return say(`You're linked${name}: ${siteUrl}/players/${link.steamId}\nTo change or unlink: <${siteUrl}/account>`, true);
}

/** /notify: always private. Sets, lists and stops the member's alerts. */
async function notifyCommandReply(i: Interaction, deps: Parameters<typeof handleInteraction>[1]): Promise<object> {
  const { store } = deps;
  const id = i.member?.user?.id ?? '';
  if (!/^\d{17,20}$/.test(id) || i.guild_id !== deps.env.discordGuildId) return say('Use /notify in the TEG Discord server.', true);
  const sub = i.data?.options?.[0];
  const opt = (name: string) => sub?.options?.find((o) => o.name === name)?.value;
  const servers = await within(deps.servers?.() ?? Promise.resolve([]), NAME_BUDGET_MS, [] as NotifyServer[]);
  const nameOf = (sid: string) => servers.find((s) => s.id === sid)?.shortName ?? 'a server that has since gone';
  const mine = store.alertsOf(id);

  if (sub?.name === 'list') {
    if (!mine.length) return say('You have no alerts. Set one with `/notify players` or `/notify map`.', true);
    const paused = mine.some((a) => a.failures >= ALERT_MAX_FAILURES);
    return say(
      `Your alerts:\n${mine.map((a, n) => `**${n + 1}.** ${describeAlert(a, nameOf)}`).join('\n')}` +
        (paused ? "\n\nThese are paused: my DMs to you didn't get through. Allow DMs from TEG server members, then set any alert to resume." : '') +
        '\nStop one with `/notify stop id:<number>`, or all with `/notify stop`.',
      true,
    );
  }

  if (sub?.name === 'stop') {
    const n = opt('id');
    if (n === undefined) {
      const gone = store.removeAlerts(id);
      return say(gone ? `Stopped all ${gone} of your alerts.` : 'You have no alerts to stop.', true);
    }
    const target = mine[Number(n) - 1];
    if (!target) return say(`You have no alert ${String(n)}. See \`/notify list\`.`, true);
    store.removeAlerts(id, target.id);
    return say(`Stopped: ${describeAlert(target, nameOf)}.`, true);
  }

  if (sub?.name !== 'players' && sub?.name !== 'map') return say('Unknown /notify option.', true);
  if (mine.length >= MAX_ALERTS) return say(`You already have ${MAX_ALERTS} alerts, the most allowed. Stop one with \`/notify stop\` first.`, true);
  const serverOpt = opt('server');
  let serverId: string | null = null;
  if (serverOpt !== undefined) {
    const v = String(serverOpt).toLowerCase();
    const s = servers.find((x) => x.id.toLowerCase() === v || x.slug === v || x.shortName.toLowerCase() === v);
    if (!s) return say(`I don't know that server. Try one of: ${servers.map((x) => x.shortName).join(', ') || 'none right now'}.`, true);
    serverId = s.id;
  }
  const whole = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = v === undefined ? fallback : Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  const alert =
    sub.name === 'players'
      ? (() => {
          const count = whole(opt('count'), 5, 100, NaN);
          return count === null ? null : { discordId: id, kind: 'players' as const, serverId, threshold: count, map: null };
        })()
      : (() => {
          const map = ALERT_MAPS.find((m) => m === opt('map'));
          const min = whole(opt('min_players'), 0, 100, 10);
          return !map || min === null ? null : { discordId: id, kind: 'map' as const, serverId, threshold: min, map };
        })();
  if (!alert) return say("That alert doesn't make sense; check the numbers.", true);
  store.addAlert(alert);
  const what = describeAlert(alert, nameOf);
  if (i.token) deps.confirmAlert?.(id, i.token, `Alert set: I'll DM you when ${what}. \`/notify list\` shows your alerts.`);
  return say(`Done. I'll DM you when ${what}.`, true);
}
