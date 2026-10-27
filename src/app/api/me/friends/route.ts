import { viewer } from '@/lib/server/accounts';
import { friendNews } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

/**
 * The signed-in member's own friend news, for the header's badge and pop-up: how many requests are
 * waiting on them and who accepted theirs since they last opened /friends. Nothing for anyone else.
 */
export async function GET() {
  const me = await viewer();
  const news = me?.steamId ? await friendNews(me.discordId) : { incoming: 0, accepted: [] };
  return Response.json(news, { headers: { 'Cache-Control': 'private, no-store' } });
}
