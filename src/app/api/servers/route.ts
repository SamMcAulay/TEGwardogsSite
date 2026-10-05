import { getServers } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

/** Public live status for every server. No player list, no private fields. */
export async function GET() {
  const loaded = await getServers().catch(() => undefined);
  if (!loaded) return Response.json({ error: 'unavailable' }, { status: 503 });
  const servers = loaded.data.map((s) => ({
    id: s.id,
    name: s.name,
    shortName: s.shortName,
    region: s.region,
    online: s.online,
    map: s.status?.map ?? null,
    players: s.playerCount,
    maxPlayers: s.status?.players.max ?? null,
    joinCode: s.joinCode,
    updatedAt: s.updatedAt,
  }));
  return Response.json({ servers }, { headers: { 'cache-control': 'public, s-maxage=10' } });
}
