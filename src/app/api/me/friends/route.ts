import { viewer } from '@/lib/server/accounts';
import { friendNews, friendsPage } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

/**
 * The signed-in member's own friend news, for the header's badge and pop-up: how many requests are
 * waiting on them and who accepted theirs since they last opened /friends. `online` lists friends
 * on a server right now, only when asked for (`?online=1`, the You menu) so the badge's poll stays cheap; friends hiding where they play have no `online` status, so
 * they never appear. Nothing for anyone else.
 */
export async function GET(req: Request) {
  const me = await viewer();
  if (!me?.steamId) return Response.json({ incoming: 0, accepted: [], online: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  const wantOnline = new URL(req.url).searchParams.get('online') === '1';
  const [news, page] = await Promise.all([friendNews(me.discordId), wantOnline ? friendsPage(me.discordId).catch(() => null) : null]);
  const online = (page?.friends ?? []).flatMap(({ status: f }) =>
    f.online && f.name ? [{ steamId: f.steamId, name: f.name, serverName: f.online.serverName, serverSlug: f.online.serverSlug }] : [],
  );
  return Response.json({ ...news, online }, { headers: { 'Cache-Control': 'private, no-store' } });
}
