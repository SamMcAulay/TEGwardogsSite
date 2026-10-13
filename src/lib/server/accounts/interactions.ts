// Discord slash commands over HTTP: Discord POSTs each use of a command to
// /api/discord/interactions and shows our JSON reply. No gateway connection, no bot process.
// Only one command: /lookup, for staff, posting a member's linked stats profile in the channel.
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
  member?: { roles?: string[] };
  data?: {
    name?: string;
    options?: { name: string; value: unknown }[];
    resolved?: { users?: Record<string, { username?: string; global_name?: string | null }>; members?: Record<string, { nick?: string | null }> };
  };
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
  if (i.type !== 2 || i.data?.name !== 'lookup') return say('Unknown command.', true);
  const { env, store, siteUrl } = deps;
  const roles = i.member?.roles ?? [];
  if (i.guild_id !== env.discordGuildId || !env.roles.staff.some((r) => roles.includes(r))) {
    return say('This command is for TEG staff only.', true);
  }
  const id = String(i.data.options?.find((o) => o.name === 'member')?.value ?? '');
  if (!/^\d{17,20}$/.test(id)) return say('Pick a member to look up.', true);
  const user = i.data.resolved?.users?.[id];
  const who = i.data.resolved?.members?.[id]?.nick || user?.global_name || user?.username || 'That member';
  const link = store.byDiscord(id);
  if (!link) return say(`**${who}** hasn't linked their Steam account. They can link it at <${siteUrl}/account>: sign in with Discord, then Steam.`);
  const name = await within(deps.playerName(link.steamId), deps.nameBudgetMs ?? NAME_BUDGET_MS, null);
  return say(`**${who}**${name ? ` plays as **${name}**` : ''}: ${siteUrl}/players/${link.steamId}`);
}
