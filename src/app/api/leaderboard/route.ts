import { leaderboard } from '@/lib/server/data';
import { parseMetric, parsePeriod } from '@/lib/server/views';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const metric = parseMetric(q.get('metric'));
  const period = parsePeriod(q.get('period'));
  const page = Math.max(1, Math.floor(Number(q.get('page'))) || 1);
  const loaded = await leaderboard({ metric, period, serverId: q.get('server'), page }).catch(() => undefined);
  if (!loaded) return Response.json({ error: 'unavailable' }, { status: 503 });
  const { rows, total, pageSize } = loaded.data;
  return Response.json(
    { metric, period, page, total, pageSize, rows },
    { headers: { 'cache-control': 'public, s-maxage=60' } },
  );
}
