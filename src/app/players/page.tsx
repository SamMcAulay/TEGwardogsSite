import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchBox } from '@/components/client';
import { Avatar } from '@/components/player';
import { Container, Empty, FactionTag, PageHeader, Panel, StatusDot } from '@/components/ui';
import { ago, int } from '@/lib/format';
import { Section, safe } from '@/components/section';
import { getServers, recentPlayers, searchPlayers } from '@/lib/server/data';
import type { PlayerSearchRow } from '@/lib/server/views';
import { one } from '@/lib/url';

export const metadata: Metadata = { title: 'Players' };

const nowSec = () => Math.floor(Date.now() / 1000);

function PlayerTile({ p, meta }: { p: PlayerSearchRow; meta: React.ReactNode }) {
  return (
    <Link
      href={`/players/${p.steamId}`}
      className="flex items-center gap-3 border-b border-line px-4 py-3 transition-colors hover:bg-surface-2 sm:border-r"
    >
      <Avatar name={p.name} steamId={p.steamId} url={p.avatarUrl} size={36} />
      <div className="min-w-0">
        <div className="truncate font-medium">{p.name}</div>
        <div className="truncate text-xs text-muted">{meta}</div>
      </div>
    </Link>
  );
}

/** null when the server list failed: the header then says "—" rather than claim nobody is on. */
function onlineCount(servers: Awaited<ReturnType<typeof getServers>> | Error): number | null {
  return servers instanceof Error ? null : servers.data.reduce((n, s) => n + s.players.length, 0);
}

export default async function PlayersPage({ searchParams }: PageProps<'/players'>) {
  const sp = await searchParams;
  const q = (one(sp.q) ?? '').trim().slice(0, 64);
  const servers = await safe(getServers());
  const [results, recent] = await Promise.all([
    q ? searchPlayers(q).catch((e) => {
          console.error('[data] player search failed:', e instanceof Error ? e.message : e);
          return 'unavailable' as const;
        })
      : Promise.resolve(null),
    safe(recentPlayers(30)),
  ]);
  // A single exact hit goes straight to the profile.
  if (q && Array.isArray(results) && results.length === 1) {
    const only = results[0] as PlayerSearchRow;
    if (only.steamId === q || only.name.toLowerCase() === q.toLowerCase()) redirect(`/players/${only.steamId}`);
  }
  const online = onlineCount(servers);
  const now = nowSec();
  const seen = (ts: number | null) => (ts ? `Seen ${ago(ts, now)}` : 'Seen —');

  return (
    <>
      <PageHeader
        eyebrow="Profiles"
        title="Players"
        description="Search by in-game name or a 17-digit Steam ID."
      >
        <div className="mt-8 max-w-2xl">
          <SearchBox defaultValue={q} autoFocus={!q} large />
        </div>
      </PageHeader>
      <Container className="mt-8 space-y-4">
        {q ? (
          <Panel
            title={`Results for “${q}”`}
            action={Array.isArray(results) ? `${results.length} found` : undefined}
            flush
          >
            {results === 'warming' ? (
              <Empty>Search is warming up. Try again in a moment.</Empty>
            ) : results === 'unavailable' ? (
              <Empty>Search is temporarily unavailable. Try again in a minute.</Empty>
            ) : results && results.length ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {(results as readonly PlayerSearchRow[]).map((p) => (
                  <PlayerTile
                    key={p.steamId}
                    p={p}
                    meta={
                      <>
                        {p.matchedAlias ? <>Also known as {p.matchedAlias} · </> : null}
                        {seen(p.lastSeen)}
                      </>
                    }
                  />
                ))}
              </div>
            ) : /^\d{17}$/.test(q) ? (
              <Empty>
                <Link href={`/players/${q}`} className="link">
                  Open profile for {q}
                </Link>
              </Empty>
            ) : (
              <Empty>No players match that name.</Empty>
            )}
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <StatusDot online={online === null ? null : online > 0} /> Online now
                </span>
              }
              action={online === null ? '—' : `${int(online)} players`}
              flush
              className="lg:col-span-1"
            >
              <Section loaded={servers}>
                {(list) => {
                  const playing = list
                    .flatMap((s) => s.players.map((p) => ({ ...p, server: s.shortName })))
                    .sort((a, b) => b.kills - a.kills);
                  return (
                    <div className="max-h-[640px] overflow-y-auto">
                      <table className="table">
                        <tbody>
                          {playing.map((p) => (
                            <tr key={p.steamId}>
                              <td className="max-w-40">
                                <Link href={`/players/${p.steamId}`} className="link block truncate font-medium">
                                  {p.name}
                                </Link>
                              </td>
                              <td>
                                <FactionTag name={p.faction} />
                              </td>
                              <td className="r text-muted">{p.server}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!playing.length && <Empty>Nobody is online.</Empty>}
                    </div>
                  );
                }}
              </Section>
            </Panel>
            <Panel title="Recently active" flush className="lg:col-span-2">
              <Section loaded={recent}>
                {(rows) => (
                  <div className="grid sm:grid-cols-2">
                    {rows.map((p) => (
                      <PlayerTile key={p.steamId} p={p} meta={seen(p.lastSeen)} />
                    ))}
                  </div>
                )}
              </Section>
            </Panel>
          </div>
        )}
      </Container>
    </>
  );
}
