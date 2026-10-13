// Discord slash commands over HTTP: Discord POSTs each use of a command to
// /api/discord/interactions and shows our JSON reply. No gateway connection, no bot process.
// /lookup (staff: a member's linked stats profile, in the channel) and /link (anyone: how to link,
// or what they're linked to, privately).
import { createPublicKey, verify } from 'node:crypto';
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

/** Replaces the guild's commands with COMMANDS (idempotent; safe on every start). */
export async function registerCommands(env: AccountsEnv, f: typeof fetch = fetch): Promise<void> {
  const res = await f(`${API}/applications/${env.discordClientId}/guilds/${env.discordGuildId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${env.discordBotToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(COMMANDS),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`registering slash commands failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

interface Interaction {
  type: number;
  guild_id?: string;
  member?: { roles?: string[]; user?: { id?: string } };
  data?: {
    name?: string;
    options?: { name: string; value: unknown }[];
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
  deps: { env: AccountsEnv; store: Store; siteUrl: string; playerName: (steamId: string) => Promise<string | null>; nameBudgetMs?: number },
): Promise<object> {
  if (i.type === 1) return { type: 1 }; // PING: Discord checking the endpoint
  if (i.type === 2 && i.data?.name === 'link') return linkCommand(i, deps);
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
