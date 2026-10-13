import type { Metadata } from 'next';
import Link from 'next/link';
import { PlayerLink } from '@/components/player';
import { Section, safe } from '@/components/section';
import { Container, Empty, PageHeader, Panel, RankCell } from '@/components/ui';
import { date, int, metres } from '@/lib/format';
import { causeLabel } from '@/lib/game';
import { records } from '@/lib/server/data';
import type { RecordRow } from '@/lib/server/views';

export const metadata: Metadata = {
  title: 'Records',
  description: 'The longest shots, best kill streaks and other all-time records on TEG WARDOGS servers.',
};

function Board({ title, note, rows, unit }: { title: string; note: string; rows: RecordRow[]; unit: (n: number) => string }) {
  return (
    <Panel title={title} action={note} flush>
      {rows.length ? (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.steamId} className="flex items-center gap-3 px-4 py-2.5">
              <RankCell rank={i + 1} />
              <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} className="min-w-0 flex-1 text-sm" />
              <span className="num font-display font-bold">{unit(r.value)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>No record yet.</Empty>
      )}
    </Panel>
  );
}

export default async function RecordsPage() {
  const data = await safe(records());
  return (
    <>
      <PageHeader
        eyebrow="Rankings"
        title="Records"
        description="The best of everything ever done on TEG WARDOGS servers. Banned players don't hold records."
      />
      <Container className="mt-8 space-y-4">
        <Panel title="Longest shots" action="Rifles and machine guns · all time" flush>
          <Section loaded={data}>
            {({ longestShots }) =>
              longestShots.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="w-14">Rank</th>
                        <th>Player</th>
                        <th className="r !text-accent">Distance</th>
                        <th>Weapon</th>
                        <th className="hidden md:table-cell">Victim</th>
                        <th className="r hidden sm:table-cell">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {longestShots.map((s, i) => (
                        <tr key={`${s.serverId}-${s.ts}-${s.steamId}`}>
                          <td>
                            <RankCell rank={i + 1} />
                          </td>
                          <td className="max-w-64">
                            <PlayerLink steamId={s.steamId} name={s.name} />
                          </td>
                          <td className="r font-display text-base font-bold text-text">{metres(s.distance)}</td>
                          <td className="text-muted">{causeLabel(s.cause)}</td>
                          <td className="hidden max-w-48 truncate text-muted md:table-cell">{s.victim}</td>
                          <td className="r hidden text-dim sm:table-cell">
                            {date(s.ts)} ·{' '}
                            <Link prefetch={false} href={`/servers/${s.serverId}`} className="link text-dim">
                              {s.serverName}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No kills of 500 m or more yet.</Empty>
              )
            }
          </Section>
        </Panel>

        <Section loaded={data}>
          {(r) => (
            <div className="grid gap-4 md:grid-cols-2">
              <Board title="Today's top killers" note="Last 24 hours, all servers" rows={r.today} unit={(n) => `${int(n)} kills`} />
              <Board title="Longest kill streaks" note="Most kills in one life" rows={r.streaks} unit={(n) => int(n)} />
              <Board title="Most headshots" note="All time" rows={r.headshots} unit={(n) => int(n)} />
              <Board title="Most vehicle kills" note="All time" rows={r.vehicleKills} unit={(n) => int(n)} />
            </div>
          )}
        </Section>
      </Container>
    </>
  );
}
