import { leaderboard } from '@/lib/server/data';
import { parseMetric, parsePeriod } from '@/lib/server/views';
import { pageParam } from '@/lib/url';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const metric = parseMetric(q.get('metric'));
  const period = parsePeriod(q.get('period'));
  const page = pageParam(q.get('page'));
  const loaded = await leaderboard({ metric, period, serverId: q.get('server'), page }).catch((e) => {
    console.error('[api] /api/leaderboard failed:', e instanceof Error ? e.message : e);
    return undefined;
  });
  if (!loaded) return Response.json({ error: 'unavailable' }, { status: 503 });
  const { rows, total, pageSize } = loaded.data;
  return Response.json(
    { metric, period, page, total, pageSize, rows },
    { headers: { 'cache-control': 'public, s-maxage=60' } },
  );
}
