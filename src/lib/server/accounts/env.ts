// Account linking configuration. Optional: with none of it set the site runs as before, without
// sign-in, badges or the priority feed. Half set is an error, so a typo can't quietly turn it off.
import type { TierRoles } from '@/lib/tiers';

export interface AccountsEnv {
  discordClientId: string;
  discordClientSecret: string;
  /** Reads members' roles over REST; needs no gateway connection or privileged intents */
  discordBotToken: string;
  discordGuildId: string;
  roles: TierRoles;
  /** Signs session cookies; at least 32 characters */
  sessionSecret: string;
  /** Bearer key for /api/priority; blank keeps that endpoint off */
  priorityApiKey: string;
  /** Where accounts.db lives (a Docker volume in production) */
  dataDir: string;
}

const REQUIRED = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'SESSION_SECRET',
] as const;

const ids = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** null when account linking is not configured at all. */
export function loadAccountsEnv(src: Record<string, string | undefined> = process.env): AccountsEnv | null {
  const val = (key: string) => (src[key] ?? '').trim();
  const missing = REQUIRED.filter((k) => !val(k));
  if (missing.length === REQUIRED.length) return null;
  if (missing.length) throw new Error(`Account linking is half configured; missing:\n  ${missing.join('\n  ')}`);
  if (val('SESSION_SECRET').length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const roles = {
    staff: ids(src.DISCORD_STAFF_ROLE_IDS),
    premium: ids(src.DISCORD_PREMIUM_ROLE_IDS),
    verified: ids(src.DISCORD_VERIFIED_ROLE_IDS),
  };
  for (const [key, list] of Object.entries(roles)) {
    const bad = list.filter((id) => !/^\d{17,20}$/.test(id));
    if (bad.length) throw new Error(`DISCORD_${key.toUpperCase()}_ROLE_IDS has non-snowflake ids: ${bad.join(', ')}`);
  }
  return {
    discordClientId: val('DISCORD_CLIENT_ID'),
    discordClientSecret: val('DISCORD_CLIENT_SECRET'),
    discordBotToken: val('DISCORD_BOT_TOKEN'),
    discordGuildId: val('DISCORD_GUILD_ID'),
    roles,
    sessionSecret: val('SESSION_SECRET'),
    priorityApiKey: val('PRIORITY_API_KEY'),
    dataDir: val('DATA_DIR') || './data',
  };
}

let memo: AccountsEnv | null | undefined;
export function accountsEnv(): AccountsEnv | null {
  if (memo === undefined) memo = loadAccountsEnv();
  return memo;
}
