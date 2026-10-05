import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Container, Empty, FactionTag, PageHeader, Pagination, Panel, Segmented } from '@/components/ui';
import { dateTime, duration } from '@/lib/format';
import { factionColor, lightingName, mapName } from '@/lib/game';
import { Section, safe } from '@/components/section';
import { getServers, listMatches } from '@/lib/server/data';
import { one, pageParam, withParams } from '@/lib/url';

export const metadata: Metadata = { title: 'Match history' };

const nowSec = () => Math.floor(Date.now() / 1000);

export default async function MatchesPage({ searchParams }: PageProps<'/matches'>) {
  const sp = await searchParams;
  const servers = await safe(getServers());
  const serverList = servers instanceof Error ? [] : servers.data;
  const serverId = serverList.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const page = pageParam(one(sp.page));
  const matches = await safe(listMatches({ serverId, page }));
  const now = nowSec();

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Match history"
        description="Every King of the Hill round played on TEG servers, with final scores and full scoreboards."
      >
        <div className="mt-8 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented
            label="Server"
            active={serverId ?? 'all'}
            items={[
              { key: 'all', label: 'All servers', href: withParams('/matches', sp, { server: null, page: null }) },
              ...serverList.map((s) => ({
                key: s.id,
                label: s.shortName,
                href: withParams('/matches', sp, { server: s.id, page: null }),
              })),
            ]}
          />
        </div>
      </PageHeader>
      <Container className="mt-8">
        <Panel title="Rounds" flush>
          <Section loaded={matches}>
            {({ rows, pages }) => (
              <>
                {rows.length ? (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Map</th>
                          <th>Server</th>
                          <th>Started</th>
                          <th className="r">Length</th>
                          <th className="r">Players</th>
                          <th className="w-56">Final score</th>
                          <th>Winner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((m) => (
                          <tr key={`${m.serverId}-${m.id}`}>
                            <td>
                              <Link href={`/matches/${m.serverId}/${m.id}`} className="link font-medium">
                                {mapName(m.map)}
                              </Link>
                              <div className="text-xs text-dim">{lightingName(m.lighting)}</div>
                            </td>
                            <td className="text-muted">{m.serverName}</td>
                            <td className="text-muted">{dateTime(m.startedAt)}</td>
                            <td className="r">{duration((m.endedAt ?? now) - m.startedAt)}</td>
                            <td className="r">{m.players}</td>
                            <td>
                              <div className="flex h-2 w-48 gap-px bg-surface-3">
                                {m.scores.map((s) => (
                                  <div
                                    key={s.name}
                                    title={`${s.name} ${s.score}`}
                                    style={{
                                      flex: Math.max(s.score, 0.5),
                                      background: factionColor(s.name, s.colorHex),
                                    }}
                                  />
                                ))}
                              </div>
                              <div className="num mt-1 text-[11px] text-dim">
                                {m.scores.map((s) => s.score).join(' · ')}
                              </div>
                            </td>
                            <td>{m.endedAt ? <FactionTag name={m.winner} /> : <Badge tone="good">Live</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No rounds recorded yet.</Empty>
                )}
                <Pagination page={page} pages={pages} href={(p) => withParams('/matches', sp, { page: p })} />
              </>
            )}
          </Section>
        </Panel>
      </Container>
    </>
  );
}
