// The one place the site asks Warcon to change something in a game: the team balancer's moves and
// whispers (lib/server/teambalance). A separate org API key, WARCON_MOVE_TOKEN, carrying only
// Warcon's "Move" and "Chat" rights; the read key stays view-only. Unset: balancing runs watch-only.

/** POST /api/servers/:id/rcon/:action, or null when no move key is configured. */
export function warconActor(
  baseUrl: string,
  token: string | undefined,
  doFetch: typeof fetch = fetch,
): ((serverId: string, action: 'changeTeam' | 'whisper', body: Record<string, unknown>) => Promise<void>) | null {
  const key = (token ?? '').trim();
  if (!key) return null;
  return async (serverId, action, body) => {
    const res = await doFetch(`${baseUrl}/api/servers/${encodeURIComponent(serverId)}/rcon/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) {
      const said = await res.json().then((b: { message?: unknown }) => (typeof b?.message === 'string' ? `: ${b.message}` : ''), () => '');
      throw new Error(`${action}: Warcon answered HTTP ${res.status}${said}`);
    }
  };
}
