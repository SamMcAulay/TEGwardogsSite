// Discord: OAuth2 sign-in (scope identify) and reading a member's roles with the bot token.
import type { AccountsEnv } from './env';

// DISCORD_API_BASE points the site at a fake Discord for local testing; production ignores it.
const API = (process.env.NODE_ENV !== 'production' && process.env.DISCORD_API_BASE) || 'https://discord.com/api/v10';
type Fetch = typeof fetch;

export class DiscordError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter = 0) {
    super(message);
  }
}

export function authorizeUrl(env: AccountsEnv, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: env.discordClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

async function call(f: Fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    throw new DiscordError(`${what}: rate limited`, 429, Math.ceil((body.retry_after ?? 5) * 1000));
  }
  return res;
}

/** Trades an OAuth code for the signed-in user's id and display name. */
export async function signedInUser(env: AccountsEnv, code: string, redirectUri: string, f: Fetch = fetch): Promise<{ id: string; name: string }> {
  const tokenRes = await call(f, `${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.discordClientId,
      client_secret: env.discordClientSecret,
    }),
  }, 'token exchange');
  if (!tokenRes.ok) throw new DiscordError(`token exchange failed (${tokenRes.status})`, tokenRes.status);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new DiscordError('token exchange returned no access token', 502);

  const meRes = await call(f, `${API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` } }, 'user lookup');
  if (!meRes.ok) throw new DiscordError(`user lookup failed (${meRes.status})`, meRes.status);
  const me = (await meRes.json()) as { id?: string; username?: string; global_name?: string | null };
  if (!me.id || !/^\d{17,20}$/.test(me.id)) throw new DiscordError('user lookup returned no id', 502);
  return { id: me.id, name: me.global_name || me.username || 'Discord user' };
}

export interface Member {
  roles: string[];
  /** server nickname, else display name, else username; for staff on /admin only, never stored */
  name: string;
}

/** The member in the TEG guild; null when they are not in it. Throws when Discord can't say. */
export async function member(env: AccountsEnv, discordId: string, f: Fetch = fetch): Promise<Member | null> {
  const res = await call(f, `${API}/guilds/${env.discordGuildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${env.discordBotToken}` },
  }, 'member lookup');
  if (res.status === 404) return null; // Unknown Member: left or never joined
  if (!res.ok) throw new DiscordError(`member lookup failed (${res.status})`, res.status);
  const m = (await res.json()) as { roles?: unknown; nick?: string | null; user?: { username?: string; global_name?: string | null } };
  return {
    roles: Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string') : [],
    name: m.nick || m.user?.global_name || m.user?.username || discordId,
  };
}

/** The member's role ids in the TEG guild; null when they are not in it. Throws when Discord can't say. */
export async function memberRoles(env: AccountsEnv, discordId: string, f: Fetch = fetch): Promise<string[] | null> {
  return (await member(env, discordId, f))?.roles ?? null;
}
