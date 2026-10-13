// Deploy-gate checks for account linking: the bot token works, the bot is in the guild, and every
// configured role id is a role there (a typo would otherwise silently grant nobody a tier).
import type { Check } from '@/lib/server/warcon/doctor';
import type { AccountsEnv } from './env';

const API = 'https://discord.com/api/v10';

export async function runAccountChecks(env: AccountsEnv, f: typeof fetch = fetch): Promise<Check[]> {
  const get = (path: string) => f(`${API}${path}`, { headers: { Authorization: `Bot ${env.discordBotToken}` }, signal: AbortSignal.timeout(10_000) });
  const out: Check[] = [];
  try {
    const me = await get('/users/@me');
    if (!me.ok) return [{ name: 'discord bot', ok: false, detail: `token rejected (${me.status}): check DISCORD_BOT_TOKEN` }];
    out.push({ name: 'discord bot', ok: true, detail: `signed in as ${((await me.json()) as { username?: string }).username}` });
    const roles = await get(`/guilds/${env.discordGuildId}/roles`);
    if (!roles.ok) return [...out, { name: 'discord guild', ok: false, detail: `bot can't see guild ${env.discordGuildId} (${roles.status}): invite it, or check DISCORD_GUILD_ID` }];
    const known = new Map(((await roles.json()) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
    out.push({ name: 'discord guild', ok: true, detail: `${known.size} roles` });
    for (const [tier, ids] of Object.entries(env.roles) as [string, string[]][]) {
      const missing = ids.filter((id) => !known.has(id));
      out.push({
        name: `${tier} roles`,
        ok: missing.length === 0,
        detail: missing.length ? `not roles in the guild: ${missing.join(', ')}` : ids.length ? ids.map((id) => known.get(id)).join(', ') : 'none configured',
      });
    }
    if (env.roundsChannelId) {
      // Seeing the channel proves View Channel; Send Messages and Embed Links show on the first post.
      const ch = await get(`/channels/${env.roundsChannelId}`);
      out.push(
        ch.ok
          ? { name: 'round results channel', ok: true, detail: `#${((await ch.json()) as { name?: string }).name}` }
          : { name: 'round results channel', ok: false, detail: `bot can't see channel ${env.roundsChannelId} (${ch.status}): allow it View Channel, Send Messages and Embed Links there` },
      );
    }
  } catch (e) {
    out.push({ name: 'discord', ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
  return out;
}
