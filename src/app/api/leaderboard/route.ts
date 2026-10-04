import { NextResponse } from 'next/server';
import { leaderboard, parseMetric, parsePeriod } from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const metric = parseMetric(url.searchParams.get('metric'));
  const period = parsePeriod(url.searchParams.get('period'));
  const { rows, total } = leaderboard({ metric, period, serverId: url.searchParams.get('server'), limit, offset });
  return NextResponse.json(
    {
      metric,
      period,
      total,
      rows: rows.map((r) => ({
        rank: r.rank,
        steamId: r.steamId,
        name: r.name,
        value: r.value,
        kills: r.kills,
        deaths: r.deaths,
        headshots: r.headshots,
        playtime: r.playtime,
        longest: r.longest,
        matches: r.matches,
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' } },
  );
}
