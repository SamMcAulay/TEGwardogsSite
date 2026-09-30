import { NextResponse } from 'next/server';
import { getServers } from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

/** Public live status for every server. Player lists omit cash and ping. */
export function GET() {
  const servers = getServers().map((s) => ({
    id: s.id,
    name: s.name,
    region: s.region,
    location: s.location,
    online: s.online,
    map: s.status?.map ?? null,
    players: s.players.length,
    maxPlayers: s.status?.players.max ?? null,
    matchSeconds: s.status?.matchSeconds ?? null,
    factionScores: s.status?.factionScores ?? [],
    joinCode: s.joinCode,
    updatedAt: s.updatedAt,
    playerList: s.players.map((p) => ({
      steamId: p.steamId,
      name: p.name,
      faction: p.faction,
      kills: p.kills,
      deaths: p.deaths,
    })),
  }));
  return NextResponse.json({ servers }, { headers: { 'Cache-Control': 'public, max-age=5' } });
}
