// Where a list of players is: online now and on which server, or when last seen. Public facts only
// (the same as server pages and profiles show), from cached data: /friends and the home page use it.
import { friendsStatus, MAX_FRIENDS } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('ids') ?? '';
  const ids = raw.split(',').filter((id) => /^\d{17}$/.test(id)).slice(0, MAX_FRIENDS);
  if (!ids.length) return Response.json({ friends: [] });
  const loaded = await friendsStatus(ids).catch((e) => {
    console.error('[api] /api/friends failed:', e instanceof Error ? e.message : e);
    return null;
  });
  if (!loaded) return Response.json({ error: 'unavailable' }, { status: 503 });
  return Response.json({ friends: loaded.data, stale: loaded.stale }, { headers: { 'cache-control': 'public, max-age=15' } });
}
