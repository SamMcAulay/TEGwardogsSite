// Optional Steam profile avatars (needs STEAM_API_KEY). Players without one get a generated badge.

import type Database from 'better-sqlite3';
import { nowSec } from './db';

const BATCH = 100;
const RECHECK_SECONDS = 7 * 86400;

export async function refreshAvatars(conn: Database.Database, apiKey: string): Promise<number> {
  const due = conn
    .prepare(
      `SELECT steam_id FROM players WHERE avatar_checked_at IS NULL OR avatar_checked_at < ?
       ORDER BY last_seen DESC LIMIT ?`,
    )
    .all(nowSec() - RECHECK_SECONDS, BATCH) as { steam_id: string }[];
  if (!due.length) return 0;

  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', due.map((d) => d.steam_id).join(','));
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Steam API HTTP ${res.status}`);
  const body = (await res.json()) as { response?: { players?: { steamid: string; avatarfull?: string }[] } };
  const avatars = new Map((body.response?.players ?? []).map((p) => [p.steamid, p.avatarfull ?? null]));

  const update = conn.prepare(`UPDATE players SET avatar_url = ?, avatar_checked_at = ? WHERE steam_id = ?`);
  const now = nowSec();
  conn.transaction(() => {
    for (const { steam_id } of due) update.run(avatars.get(steam_id) ?? null, now, steam_id);
  })();
  return due.length;
}
