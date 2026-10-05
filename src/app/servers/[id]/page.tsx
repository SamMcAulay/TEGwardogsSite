import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AreaChart } from '@/components/charts';
import { AutoRefresh, CopyButton } from '@/components/client';
import { FactionScores, KillList, MapBackdrop } from '@/components/game';
import { PlayerLink } from '@/components/player';
import {
  Badge,
  Container,
  Empty,
  FactionTag,
  PageHeader,
  Panel,
  PanelLink,
  RankCell,
  Segmented,
  Stat,
  StatGrid,
  StatusDot,
} from '@/components/ui';
import { ago, clock, compact, dateTime, duration, int, kd, money } from '@/lib/format';
import { factionColor, lightingName, mapName, REGION_NAMES } from '@/lib/game';
import { Section, safe } from '@/components/section';
import { getServer, leaderboard, listMatches, population, recentKills, serverTotals } from '@/lib/server/data';
import type { LivePlayer } from '@/lib/server/views';

export async function generateMetadata({ params }: PageProps<'/servers/[id]'>): Promise<Metadata> {
  const { id } = await params;
  try {
    const s = await getServer(id);
    return { title: s ? s.data.name : 'Server not found' };
  } catch {
    return { title: 'Server' };
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

function Scoreboard({ faction, players, score }: { faction: string; players: LivePlayer[]; score?: number }) {
  const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return (
    <div className="min-w-0 border border-line">
      <div
        className="flex items-center justify-between border-b border-line px-3 py-2.5"
        style={{ boxShadow: `inset 3px 0 0 ${factionColor(faction)}` }}
      >
        <span className="display text-sm tracking-[0.08em]">{faction}</span>
        <span className="num text-xs text-muted">
          {players.length} players
          {score != null && (
            <>
              {' '}
              · <span className="font-semibold text-text">{score}</span> pts
            </>
          )}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table !text-[13px]">
          <thead>
            <tr>
              <th>Player</th>
              <th className="r">K</th>
              <th className="r">D</th>
              <th className="r hidden sm:table-cell">Cash</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.steamId}>
                <td className="max-w-40">
                  <PlayerLink steamId={p.steamId} name={p.name} avatar={false} />
                </td>
                <td className="r font-semibold">{p.kills}</td>
                <td className="r text-muted">{p.deaths}</td>
                <td className="r hidden text-muted sm:table-cell">{money(p.cash)}</td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  Nobody
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ServerPage({ params, searchParams }: PageProps<'/servers/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const loadedServer = await safe(getServer(id));
  if (loadedServer instanceof Error) {
    // Warcon is unreachable and nothing is cached: an outage, not a missing server.
    return (
      <>
        <PageHeader title="Server" />
        <Container className="mt-8">
          <Panel title="Server">
            <Section loaded={loadedServer}>{() => null}</Section>
          </Panel>
        </Container>
      </>
    );
  }
  if (!loadedServer) notFound();
  const server = loadedServer.data;
  const range = sp.range === '7d' ? '7d' : '24h';
  const now = nowSec();
  const [pop, totals, matches, top, kills] = await Promise.all([
    safe(population(server.id, range)),
    safe(serverTotals(server.id)),
    safe(listMatches({ serverId: server.id, limit: 8 })),
    safe(leaderboard({ metric: 'kills', period: '7d', serverId: server.id })),
    safe(recentKills({ serverId: server.id, limit: 15 })),
  ]);
  const st = server.status;
  const factions = st?.factionScores.map((f) => f.name) ?? ['Valkyra', 'Lonestar', 'Manticore'];

  return (
    <>
      <AutoRefresh seconds={8} />
      <PageHeader
        eyebrow={
          <>
            <Link href="/servers" className="link text-muted">
              Servers
            </Link>
            <span className="text-dim">/</span>
            {REGION_NAMES[server.region] ?? server.region}
          </>
        }
        title={
          <span className="flex items-center gap-4">
            {server.name}
            <StatusDot online={server.online} className="size-3" />
          </span>
        }
        description={
          server.online
            ? `Up ${duration(server.startedAt ? now - server.startedAt : 0)} · last polled ${ago(server.updatedAt, now)}`
            : `Offline${server.updatedAt ? ` · last seen ${ago(server.updatedAt, now)}` : ''}`
        }
        actions={
          server.joinCode && (
            <div className="flex items-center gap-2 border border-line-strong bg-surface px-3 py-2">
              <span className="eyebrow !text-[0.66rem]">Join code</span>
              <code className="font-mono text-xs text-text">{server.joinCode}</code>
              <CopyButton value={server.joinCode} />
            </div>
          )
        }
      />

      <Container className="mt-8 space-y-4">
        <StatGrid className="grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
          <Stat
            label="Players"
            value={
              <>
                {server.playerCount}
                <span className="text-lg text-dim">/{st?.players.max ?? '—'}</span>
              </>
            }
            accent
          />
          <Stat label="Map" value={st ? mapName(st.map) : '—'} sub={st ? lightingName(st.lighting) : undefined} />
          <Stat
            label="Match time"
            value={st?.matchSeconds != null ? clock(st.matchSeconds) : '—'}
            sub="King of the Hill"
          />
          <Section loaded={totals}>
            {(t) => (
              <>
                <Stat label="Players · 7d" value={int(t.uniquePlayers)} />
                <Stat label="Matches · 7d" value={int(t.matches)} />
                <Stat label="Kills · 7d" value={compact(t.kills)} />
                <Stat label="Headshots · 7d" value={compact(t.headshots)} />
                <Stat label="Peak · 7d" value={int(t.peak)} />
              </>
            )}
          </Section>
        </StatGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Current round" className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-0 text-accent/20">
              <MapBackdrop map={st?.map} />
              <div className="absolute inset-0 bg-gradient-to-b from-surface/40 to-surface" />
            </div>
            <div className="relative">
              {st ? (
                <>
                  <div className="mb-5 flex items-end justify-between">
                    <div>
                      <div className="display text-3xl leading-none">{mapName(st.map)}</div>
                      {st.scoreCap != null && (
                        <div className="mt-1 text-xs text-muted">First to {st.scoreCap} points</div>
                      )}
                    </div>
                  </div>
                  <FactionScores scores={st.factionScores} cap={st.scoreCap} />
                </>
              ) : (
                <Empty>Server is offline.</Empty>
              )}
            </div>
          </Panel>
          <Panel
            title="Population"
            className="lg:col-span-2"
            action={
              <Segmented
                label="Range"
                active={range}
                items={(['24h', '7d'] as const).map((r) => ({ key: r, label: r, href: `?range=${r}` }))}
              />
            }
          >
            <Section loaded={pop}>
              {(points) => (
                <AreaChart
                  points={points.map((p) => ({ t: p.ts, v: p.players }))}
                  capacity={st?.players.max}
                  height={230}
                  unit=" players"
                />
              )}
            </Section>
          </Panel>
        </div>

        <Panel title="Live scoreboard" action={<span>{server.playerCount} connected</span>}>
          {server.players.length ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {factions.map((f) => (
                <Scoreboard
                  key={f}
                  faction={f}
                  players={server.players.filter((p) => p.faction === f)}
                  score={st?.factionScores.find((x) => x.name === f)?.score}
                />
              ))}
            </div>
          ) : server.playerCount ? (
            <Empty>This server reports a player count but not a scoreboard.</Empty>
          ) : (
            <Empty>No one is playing right now.</Empty>
          )}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-5">
          <Panel
            title="Recent rounds"
            className="lg:col-span-3"
            flush
            action={<PanelLink href={`/matches?server=${server.id}`}>All rounds</PanelLink>}
          >
            <Section loaded={matches}>
              {({ rows }) => (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Map</th>
                        <th>Started</th>
                        <th className="r">Length</th>
                        <th className="r">Peak</th>
                        <th>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link href={`/matches/${m.serverId}/${m.id}`} className="link font-medium">
                              {mapName(m.map)}
                            </Link>
                            {!m.endedAt && (
                              <span className="ml-2">
                                <Badge tone="good">Live</Badge>
                              </span>
                            )}
                          </td>
                          <td className="text-muted">{dateTime(m.startedAt)}</td>
                          <td className="r">{duration((m.endedAt ?? now) - m.startedAt)}</td>
                          <td className="r">{m.peakPlayers}</td>
                          <td>
                            {m.endedAt ? <FactionTag name={m.winner} /> : <span className="text-dim">In progress</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </Panel>
          <Panel
            title="Top players · 7d"
            className="lg:col-span-2"
            flush
            action={<PanelLink href={`/leaderboards?server=${server.id}`}>Leaderboard</PanelLink>}
          >
            <Section loaded={top}>
              {({ rows }) => (
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Player</th>
                      <th className="r">Kills</th>
                      <th className="r">K/D</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r) => (
                      <tr key={r.steamId}>
                        <td>
                          <RankCell rank={r.rank} />
                        </td>
                        <td className="max-w-44">
                          <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} />
                        </td>
                        <td className="r font-semibold">{int(r.kills)}</td>
                        <td className="r text-muted">{kd(r.kills, r.deaths)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </Panel>
        </div>

        <Panel title="Kill feed" flush action={<PanelLink href={`/feed?server=${server.id}`}>Full feed</PanelLink>}>
          <Section loaded={kills}>
            {(rows) => (rows.length ? <KillList kills={rows} /> : <Empty>No kills recorded yet.</Empty>)}
          </Section>
        </Panel>
      </Container>
    </>
  );
}
