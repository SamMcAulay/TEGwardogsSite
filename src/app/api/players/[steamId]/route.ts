import { presenceHidden } from '@/lib/server/accounts';
import { getPlayer } from '@/lib/server/data';
import { withoutPresence } from '@/lib/server/presence';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/players/[steamId]'>) {
  const { steamId } = await ctx.params;
  if (!/^\d{17}$/.test(steamId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const loaded = await getPlayer(steamId).catch((e) => {
    console.error('[api] /api/players failed:', e instanceof Error ? e.message : e);
    return undefined;
  });
  if (loaded === undefined) return Response.json({ error: 'unavailable' }, { status: 503 });
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 });
  // A member who hides where they play is hidden here too: the API has no friends.
  const p = presenceHidden().has(steamId) ? withoutPresence(loaded.data, Math.floor(Date.now() / 1000)) : loaded.data;
  return Response.json(
    {
      steamId: p.steamId, name: p.name, avatarUrl: p.avatarUrl, firstSeen: p.firstSeen, lastSeen: p.lastSeen,
      rank: typeof p.rank === 'number' ? p.rank : null, totals: p.totals, online: p.onlineOn ? { serverId: p.onlineOn.serverId } : null,
      weapons: p.weapons.slice(0, 10),
    },
    { headers: { 'cache-control': 'public, s-maxage=60' } },
  );
}
