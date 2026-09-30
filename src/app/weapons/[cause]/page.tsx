import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts';
import { KillList } from '@/components/game';
import { PlayerLink } from '@/components/player';
import { Container, Empty, PageHeader, Panel, RankCell, Segmented, Stat, StatGrid } from '@/components/ui';
import { compact, int, metres, pct } from '@/lib/format';
import { causeInfo } from '@/lib/game';
import {
  parsePeriod,
  PERIOD_LABELS,
  PERIODS,
  periodStartTs,
  recentKills,
  weaponDaily,
  weaponLongest,
  weaponStats,
  weaponTopPlayers,
} from '@/lib/server/queries';
import { one, withParams } from '@/lib/url';

export async function generateMetadata({ params }: PageProps<'/weapons/[cause]'>): Promise<Metadata> {
  return { title: causeInfo(decodeURIComponent((await params).cause)).label };
}

export default async function WeaponPage({ params, searchParams }: PageProps<'/weapons/[cause]'>) {
  const cause = decodeURIComponent((await params).cause);
  const sp = await searchParams;
  const period = parsePeriod(one(sp.period), '30d');
  const since = periodStartTs(period);
  const all = weaponStats(period);
  const stats = all.find((w) => w.cause === cause);
  const everUsed = stats ?? weaponStats('all').find((w) => w.cause === cause);
  if (!everUsed) notFound();

  const info = causeInfo(cause);
  const total = all.reduce((a, w) => a + w.kills, 0);
  const rank = stats ? all.indexOf(stats) + 1 : null;
  const top = weaponTopPlayers(cause, since, 20);
  const longest = weaponLongest(cause, since, 8);
  const daily = weaponDaily(cause, 30);
  const feed = recentKills({ cause, limit: 12 });
  const base = `/weapons/${encodeURIComponent(cause)}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/weapons" className="link text-muted">
              Weapons
            </Link>
            <span className="text-dim">/</span>
            <span className="capitalize">{info.kind}</span>
          </>
        }
        title={info.label}
        description={<span className="font-mono text-xs text-dim">{cause}</span>}
        actions={
          <Segmented
            label="Period"
            active={period}
            items={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p], href: withParams(base, sp, { period: p }) }))}
          />
        }
      />
      <Container className="mt-8 space-y-4">
        <StatGrid className="grid-cols-2 md:grid-cols-5">
          <Stat
            label="Kills"
            value={compact(stats?.kills ?? 0)}
            sub={rank ? `#${rank} of ${all.length} weapons` : 'Unused this period'}
            accent
          />
          <Stat label="Share of kills" value={pct(stats?.kills ?? 0, total)} />
          <Stat label="Headshot %" value={pct(stats?.headshots ?? 0, stats?.kills ?? 0)} />
          <Stat label="Avg distance" value={stats?.avgDistance ? metres(stats.avgDistance) : '—'} />
          <Stat label="Longest" value={stats?.longest ? metres(stats.longest) : '—'} />
        </StatGrid>

        <Panel title="Kills per day · 30 days">
          <BarChart
            bars={daily.map((d) => ({
              label: d.day.slice(5).split('-').reverse().join('/'),
              value: d.kills,
              detail: `${int(d.kills)} kills`,
            }))}
            height={140}
          />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-5">
          <Panel title={`Top users · ${PERIOD_LABELS[period]}`} flush className="lg:col-span-3">
            {top.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-12">#</th>
                      <th>Player</th>
                      <th className="r">Kills</th>
                      <th className="r">HS %</th>
                      <th className="r">Longest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((p, i) => (
                      <tr key={p.steamId}>
                        <td>
                          <RankCell rank={i + 1} />
                        </td>
                        <td className="max-w-56">
                          <PlayerLink steamId={p.steamId} name={p.name} />
                        </td>
                        <td className="r font-semibold">{int(p.kills)}</td>
                        <td className="r text-muted">{pct(p.headshots, p.kills)}</td>
                        <td className="r text-muted">{metres(p.longest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No kills this period.</Empty>
            )}
          </Panel>
          <Panel title="Longest kills" flush className="lg:col-span-2">
            <ol className="divide-y divide-line">
              {longest.map((k, i) => (
                <li key={k.eventId} className="flex items-center gap-3 px-4 py-2.5">
                  <RankCell rank={i + 1} />
                  <div className="min-w-0 flex-1 text-sm">
                    <PlayerLink steamId={k.killerSteamId} name={k.killerName} avatar={false} />
                    <div className="truncate text-xs text-dim">
                      on {k.victimName} · {k.serverName}
                    </div>
                  </div>
                  <span className="num font-display text-[15px] font-bold">{metres(k.distance)}</span>
                </li>
              ))}
              {!longest.length && <Empty>No distances recorded.</Empty>}
            </ol>
          </Panel>
        </div>

        <Panel title="Recent kills" flush>
          {feed.length ? <KillList kills={feed} showServer /> : <Empty>None yet.</Empty>}
        </Panel>
      </Container>
    </>
  );
}
