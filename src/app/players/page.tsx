import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchBox } from '@/components/client';
import { Avatar } from '@/components/player';
import { Container, Empty, FactionTag, PageHeader, Panel, StatusDot } from '@/components/ui';
import { ago, int } from '@/lib/format';
import { getServers, recentPlayers, searchPlayers, type PlayerSearchRow } from '@/lib/server/queries';
import { one } from '@/lib/url';

export const metadata: Metadata = { title: 'Players' };

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

export default async function PlayersPage({ searchParams }: PageProps<'/players'>) {
  const sp = await searchParams;
  const q = (one(sp.q) ?? '').trim().slice(0, 64);
  const results = q ? searchPlayers(q, 60) : [];
  // A single exact hit goes straight to the profile.
  if (q && results.length === 1 && (results[0].steamId === q || results[0].name.toLowerCase() === q.toLowerCase())) {
    redirect(`/players/${results[0].steamId}`);
  }
  const servers = getServers();
  const online = servers.flatMap((s) => s.players.map((p) => ({ ...p, server: s.shortName })));
  const recent = q ? [] : recentPlayers(30);

  return (
    <>
      <PageHeader
        eyebrow="Profiles"
        title="Players"
        description="Search by in-game name, a previous alias, or a 17-digit Steam ID."
      >
        <div className="mt-8 max-w-2xl">
          <SearchBox defaultValue={q} autoFocus={!q} large />
        </div>
      </PageHeader>
      <Container className="mt-8 space-y-4">
        {q ? (
          <Panel
            title={`Results for “${q}”`}
            action={`${results.length}${results.length === 60 ? '+' : ''} found`}
            flush
          >
            {results.length ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {results.map((p) => (
                  <PlayerTile
                    key={p.steamId}
                    p={p}
                    meta={
                      <>
                        {p.matchedAlias ? <>Also known as {p.matchedAlias} · </> : null}Seen {ago(p.lastSeen)}
                      </>
                    }
                  />
                ))}
              </div>
            ) : (
              <Empty>No players match that name.</Empty>
            )}
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <StatusDot online={online.length > 0} /> Online now
                </span>
              }
              action={`${int(online.length)} players`}
              flush
              className="lg:col-span-1"
            >
              <div className="max-h-[640px] overflow-y-auto">
                <table className="table">
                  <tbody>
                    {online
                      .sort((a, b) => b.kills - a.kills)
                      .map((p) => (
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
                {!online.length && <Empty>Nobody is online.</Empty>}
              </div>
            </Panel>
            <Panel title="Recently active" flush className="lg:col-span-2">
              <div className="grid sm:grid-cols-2">
                {recent.map((p) => (
                  <PlayerTile key={p.steamId} p={p} meta={`Seen ${ago(p.lastSeen)}`} />
                ))}
              </div>
            </Panel>
          </div>
        )}
      </Container>
    </>
  );
}
