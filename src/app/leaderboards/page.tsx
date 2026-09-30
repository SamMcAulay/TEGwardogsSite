import type { Metadata } from 'next';
import { PlayerLink } from '@/components/player';
import { Container, Empty, PageHeader, Pagination, Panel, RankCell, Segmented, cx } from '@/components/ui';
import { ago, duration, hours, int, kd, metres, pct } from '@/lib/format';
import {
  getServers,
  leaderboard,
  METRIC_LABELS,
  METRICS,
  MIN_KILLS,
  parseMetric,
  parsePeriod,
  PERIOD_LABELS,
  PERIODS,
  type LeaderRow,
  type Metric,
} from '@/lib/server/queries';
import { one, pageParam, withParams } from '@/lib/url';

export const metadata: Metadata = { title: 'Leaderboards' };

const PAGE_SIZE = 50;

function valueOf(metric: Metric, r: LeaderRow): string {
  switch (metric) {
    case 'kills':
      return int(r.kills);
    case 'kd':
      return kd(r.kills, r.deaths);
    case 'kph':
      return (r.value ?? 0).toFixed(1);
    case 'headshots':
      return int(r.headshots);
    case 'hsr':
      return pct(r.headshots, r.kills);
    case 'longest':
      return metres(r.longest);
    case 'playtime':
      return hours(r.playtime);
  }
}

const COLUMNS: { key: Metric | 'deaths' | 'matches'; label: string; cell: (r: LeaderRow) => string; hide?: string }[] =
  [
    { key: 'kills', label: 'Kills', cell: (r) => int(r.kills) },
    { key: 'deaths', label: 'Deaths', cell: (r) => int(r.deaths), hide: 'hidden md:table-cell' },
    { key: 'kd', label: 'K/D', cell: (r) => kd(r.kills, r.deaths) },
    { key: 'hsr', label: 'HS %', cell: (r) => pct(r.headshots, r.kills), hide: 'hidden md:table-cell' },
    {
      key: 'kph',
      label: 'K/h',
      cell: (r) => (r.playtime ? ((r.kills * 3600) / r.playtime).toFixed(1) : '—'),
      hide: 'hidden lg:table-cell',
    },
    { key: 'longest', label: 'Longest', cell: (r) => metres(r.longest), hide: 'hidden lg:table-cell' },
    { key: 'playtime', label: 'Playtime', cell: (r) => duration(r.playtime), hide: 'hidden sm:table-cell' },
  ];

const NOTES: Partial<Record<Metric, (min: number) => string>> = {
  kd: (m) => `Minimum ${m} kills in the period.`,
  hsr: (m) => `Minimum ${m} kills in the period.`,
  kph: () => 'Minimum playtime applies for the period.',
  longest: () => 'Longest single kill, any weapon.',
};

export default async function LeaderboardsPage({ searchParams }: PageProps<'/leaderboards'>) {
  const sp = await searchParams;
  const metric = parseMetric(one(sp.metric));
  const period = parsePeriod(one(sp.period));
  const servers = getServers();
  const serverId = servers.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const page = pageParam(one(sp.page));
  const { rows, total } = leaderboard({ metric, period, serverId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.ceil(total / PAGE_SIZE);
  const note = NOTES[metric]?.(MIN_KILLS[period]);

  return (
    <>
      <PageHeader
        eyebrow="Rankings"
        title="Leaderboards"
        description="Ranked from every round played on TEG servers. Days are UTC."
      >
        <div className="mt-8 flex flex-col gap-3">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Segmented
              label="Stat"
              active={metric}
              items={METRICS.map((m) => ({
                key: m,
                label: METRIC_LABELS[m],
                href: withParams('/leaderboards', sp, { metric: m, page: null }),
              }))}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Segmented
              label="Period"
              active={period}
              items={PERIODS.map((p) => ({
                key: p,
                label: PERIOD_LABELS[p],
                href: withParams('/leaderboards', sp, { period: p, page: null }),
              }))}
            />
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <Segmented
                label="Server"
                active={serverId ?? 'all'}
                items={[
                  {
                    key: 'all',
                    label: 'All servers',
                    href: withParams('/leaderboards', sp, { server: null, page: null }),
                  },
                  ...servers.map((s) => ({
                    key: s.id,
                    label: s.shortName,
                    href: withParams('/leaderboards', sp, { server: s.id, page: null }),
                  })),
                ]}
              />
            </div>
          </div>
        </div>
      </PageHeader>

      <Container className="mt-8">
        <Panel
          title={`${METRIC_LABELS[metric]} · ${PERIOD_LABELS[period]}${serverId ? ` · ${servers.find((s) => s.id === serverId)?.shortName}` : ''}`}
          action={
            <span>
              {int(total)} ranked{note ? ` · ${note}` : ''}
            </span>
          }
          flush
        >
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-14">Rank</th>
                    <th>Player</th>
                    <th className="r !text-accent">{METRIC_LABELS[metric]}</th>
                    {COLUMNS.filter((c) => c.key !== metric).map((c) => (
                      <th key={c.key} className={cx('r', c.hide)}>
                        {c.label}
                      </th>
                    ))}
                    <th className="r hidden xl:table-cell">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.steamId}>
                      <td>
                        <RankCell rank={r.rank} />
                      </td>
                      <td className="max-w-64">
                        <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} />
                      </td>
                      <td className="r font-display text-base font-bold text-text">{valueOf(metric, r)}</td>
                      {COLUMNS.filter((c) => c.key !== metric).map((c) => (
                        <td key={c.key} className={cx('r text-muted', c.hide)}>
                          {c.cell(r)}
                        </td>
                      ))}
                      <td className="r hidden text-dim xl:table-cell">{ago(r.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nobody qualifies for this board yet.</Empty>
          )}
          <Pagination page={page} pages={pages} href={(p) => withParams('/leaderboards', sp, { page: p })} />
        </Panel>
      </Container>
    </>
  );
}
