import { NextResponse } from 'next/server';
import { getPlayer, playerRank, playerTotals, playerWeapons } from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/players/[steamId]'>) {
  const { steamId } = await ctx.params;
  const player = /^\d{17}$/.test(steamId) ? getPlayer(steamId) : null;
  if (!player) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(
    {
      steamId: player.steamId,
      name: player.name,
      firstSeen: player.firstSeen,
      lastSeen: player.lastSeen,
      online: player.onlineOn ? { serverId: player.onlineOn.serverId, faction: player.onlineOn.live.faction } : null,
      allTime: player.totals,
      last7Days: playerTotals(steamId, '7d'),
      ranks: {
        kills: playerRank(steamId, 'kills', 'all'),
        kd: playerRank(steamId, 'kd', 'all'),
      },
      weapons: playerWeapons(steamId, 0, 10),
    },
    { headers: { 'Cache-Control': 'public, max-age=30' } },
  );
}
