import type { Metadata } from 'next';
import { PlayerLink } from '@/components/player';
import { Section, safe } from '@/components/section';
import { Container, Empty, PageHeader, Pagination, Panel, RankCell, Segmented, cx } from '@/components/ui';
import { ago, duration, int, kd, money, pct } from '@/lib/format';
import { getServers, leaderboard } from '@/lib/server/data';
import { METRIC_LABELS, METRICS, parseMetric, parsePeriod, PERIOD_LABELS, PERIODS, type LeaderRow, type Metric } from '@/lib/server/views';
import { one, withParams } from '@/lib/url';

export const metadata: Metadata = { title: 'Leaderboards' };

const nowSec = () => Math.floor(Date.now() / 1000);

function valueOf(metric: Metric, r: LeaderRow): string {
  switch (metric) {
    case 'kd':
      return kd(r.kills, r.deaths);
    case 'perHour':
      return r.value.toFixed(1);
    case 'playtime':
      return duration(r.playtime);
    case 'winRate':
      return pct(r.wins, r.matches);
    case 'cash':
      return money(r.cash);
    case 'kills':
      return int(r.kills);
    case 'deaths':
      return int(r.deaths);
    case 'matches':
      return int(r.matches);
    case 'wins':
      return int(r.wins);
  }
}

const COLUMNS: { key: Metric; label: string; cell: (r: LeaderRow) => string; hide?: string }[] = [
  { key: 'kills', label: 'Kills', cell: (r) => int(r.kills) },
  { key: 'deaths', label: 'Deaths', cell: (r) => int(r.deaths), hide: 'hidden md:table-cell' },
  { key: 'kd', label: 'K/D', cell: (r) => kd(r.kills, r.deaths) },
  { key: 'matches', label: 'Matches', cell: (r) => int(r.matches), hide: 'hidden md:table-cell' },
  { key: 'wins', label: 'Wins', cell: (r) => int(r.wins), hide: 'hidden lg:table-cell' },
  { key: 'playtime', label: 'Playtime', cell: (r) => duration(r.playtime), hide: 'hidden sm:table-cell' },
];

export default async function LeaderboardsPage({ searchParams }: PageProps<'/leaderboards'>) {
  const sp = await searchParams;
  const metric = parseMetric(one(sp.metric));
  const period = parsePeriod(one(sp.period), '7d');
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const servers = await safe(getServers());
  const serverList = servers instanceof Error ? [] : servers.data;
  const serverId = serverList.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const board = await safe(leaderboard({ metric, period, serverId, page }));
  const now = nowSec();

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
                  ...serverList.map((s) => ({
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
          title={`${METRIC_LABELS[metric]} · ${PERIOD_LABELS[period]}${serverId ? ` · ${serverList.find((s) => s.id === serverId)?.shortName}` : ''}`}
          action={
            <span>
              {board instanceof Error ? '' : `${int(board.data.total)} ranked · `}Players with at least an hour on
              the server
            </span>
          }
          flush
        >
          <Section loaded={board}>
            {({ rows, total, pageSize }) => (
              <>
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
                            <td className="r hidden text-dim xl:table-cell">{r.lastSeen ? ago(r.lastSeen, now) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>Nobody qualifies for this board yet.</Empty>
                )}
                <Pagination
                  page={page}
                  pages={Math.ceil(total / pageSize)}
                  href={(p) => withParams('/leaderboards', sp, { page: p })}
                />
              </>
            )}
          </Section>
        </Panel>
      </Container>
    </>
  );
}
