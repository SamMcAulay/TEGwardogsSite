// Discord: OAuth2 sign-in (scope identify) and reading a member's roles with the bot token.
import type { AccountsEnv } from './env';

const API = 'https://discord.com/api/v10';
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

/** The member's role ids in the TEG guild; null when they are not in it. Throws when Discord can't say. */
export async function memberRoles(env: AccountsEnv, discordId: string, f: Fetch = fetch): Promise<string[] | null> {
  const res = await call(f, `${API}/guilds/${env.discordGuildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${env.discordBotToken}` },
  }, 'member lookup');
  if (res.status === 404) return null; // Unknown Member: left or never joined
  if (!res.ok) throw new DiscordError(`member lookup failed (${res.status})`, res.status);
  const m = (await res.json()) as { roles?: unknown };
  return Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string') : [];
}
