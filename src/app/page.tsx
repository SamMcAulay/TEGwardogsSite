import Link from 'next/link';
import { AreaChart } from '@/components/charts';
import { AutoRefresh } from '@/components/client';
import { KillList, MapBackdrop, ServerCard } from '@/components/game';
import { PlayerLink } from '@/components/player';
import { Container, Meter, Panel, PanelLink, RankCell, Stat, StatGrid } from '@/components/ui';
import { Section, safe } from '@/components/section';
import { compact, int, kd, pct } from '@/lib/format';
import { factionColor } from '@/lib/game';
import { factionWins, getServers, leaderboard, networkSummary, population, recentKills } from '@/lib/server/data';
import type { LeaderRow, Loaded } from '@/lib/server/views';

function MiniBoard({
  title,
  loaded,
  value,
  href,
}: {
  title: string;
  loaded: Loaded<{ rows: LeaderRow[] }> | Error;
  value: (r: LeaderRow) => string;
  href: string;
}) {
  return (
    <Panel title={title} action={<PanelLink href={href}>Full board</PanelLink>} flush>
      <Section loaded={loaded}>
        {({ rows }) => (
          <ol className="divide-y divide-line">
            {rows.slice(0, 5).map((r) => (
              <li key={r.steamId} className="flex items-center gap-3 px-4 py-2.5">
                <RankCell rank={r.rank} />
                <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} className="flex-1 text-sm" />
                <span className="num font-display text-[15px] font-bold">{value(r)}</span>
              </li>
            ))}
            {!rows.length && <li className="px-4 py-8 text-center text-sm text-muted">No data yet.</li>}
          </ol>
        )}
      </Section>
    </Panel>
  );
}

export default async function Home() {
  const servers = await safe(getServers());
  const [summary, pop, kills, kdBoard, feed, wins] = await Promise.all([
    // Without the server list there is no summary to give; never a row of zeros.
    servers instanceof Error ? servers : safe(networkSummary(servers.data)),
    safe(population(null, '24h')),
    safe(leaderboard({ metric: 'kills', period: '7d' })),
    safe(leaderboard({ metric: 'kd', period: '7d' })),
    safe(recentKills({ limit: 12 })),
    safe(factionWins(null)),
  ]);

  return (
    <>
      <AutoRefresh seconds={15} />
      <section className="relative overflow-hidden border-b border-line">
        <div className="grid-bg absolute inset-0" />
        <div className="absolute inset-y-0 right-0 w-full text-accent/25 md:w-2/3">
          <MapBackdrop map="teg-hero" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/70 to-transparent" />
        </div>
        <Container className="relative grid gap-10 py-14 md:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <div>
            <div className="eyebrow mb-4 flex items-center gap-2">
              <span className="inline-block h-px w-8 bg-accent" /> The Employed Gamers · WARDOGS
            </div>
            <h1 className="display text-5xl leading-[0.92] sm:text-6xl lg:text-7xl">
              No sweats.
              <br />
              <span className="text-accent">Just stats.</span>
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">
              Live status for every TEG server, full match history, player profiles and leaderboards — recorded straight
              from the servers, updated every few seconds.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/servers"
                className="bg-accent px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] text-accent-ink transition-opacity hover:opacity-90"
              >
                Server status
              </Link>
              <Link
                href="/leaderboards"
                className="border border-line-strong bg-bg/60 px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] transition-colors hover:border-accent hover:text-accent"
              >
                Leaderboards
              </Link>
            </div>
          </div>
          <StatGrid className="grid-cols-2">
            <Section loaded={summary}>
              {(sm) => (
                <>
                  <Stat
                    label="Players online"
                    value={int(sm.playersOnline)}
                    sub={`of ${int(sm.capacity)} slots`}
                    accent
                  />
                  <Stat label="Servers online" value={`${sm.serversOnline}/${sm.serversTotal}`} sub="TEG network" />
                  <Stat label="Kills · 24h" value={compact(sm.killsToday)} sub={`${int(sm.matchesToday)} matches`} />
                  <Stat label="Players · 24h" value={int(sm.playersToday)} sub="per-server total" />
                </>
              )}
            </Section>
          </StatGrid>
        </Container>
      </section>

      <Container className="mt-10 space-y-10">
        <section>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="display text-2xl">Live servers</h2>
            <PanelLink href="/servers">All servers</PanelLink>
          </div>
          <Section loaded={servers}>
            {(rows) => (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((s) => (
                  <ServerCard key={s.id} server={s} />
                ))}
              </div>
            )}
          </Section>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Network population · 24h"
            action={
              summary instanceof Error ? null : <span className="num">Peak on one server {int(summary.data.peakToday)}</span>
            }
            className="lg:col-span-2"
          >
            <Section loaded={pop}>
              {(points) => (
                <AreaChart points={points.map((p) => ({ t: p.ts, v: p.players }))} height={220} unit=" players" />
              )}
            </Section>
          </Panel>
          <Panel title="Faction wins · 7 days">
            <Section loaded={wins}>
              {(data) => {
                const totalWins = data.reduce((a, w) => a + w.wins, 0);
                return (
                  <div className="space-y-4">
                    {data.map((w) => (
                      <div key={w.faction}>
                        <div className="mb-1.5 flex items-baseline justify-between">
                          <span className="font-display text-sm font-semibold uppercase tracking-[0.1em]">
                            {w.faction}
                          </span>
                          <span className="num text-sm">
                            <span className="font-semibold">{int(w.wins)}</span>
                            <span className="ml-2 text-muted">{pct(w.wins, totalWins, 0)}</span>
                          </span>
                        </div>
                        <Meter value={w.wins} max={totalWins} color={factionColor(w.faction)} />
                      </div>
                    ))}
                    {!data.length && (
                      <div className="py-8 text-center text-sm text-muted">No finished matches yet.</div>
                    )}
                    <p className="pt-2 text-xs text-dim">
                      Rounds won across all servers, matches with at least two players.
                    </p>
                  </div>
                );
              }}
            </Section>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MiniBoard
            title="Most kills · 7d"
            loaded={kills}
            value={(r) => int(r.kills)}
            href="/leaderboards?metric=kills"
          />
          <MiniBoard
            title="Best K/D · 7d"
            loaded={kdBoard}
            value={(r) => kd(r.kills, r.deaths)}
            href="/leaderboards?metric=kd"
          />
        </div>

        <div>
          <Panel title="Live kill feed" action={<PanelLink href="/feed">Open feed</PanelLink>} flush>
            <Section loaded={feed}>
              {(rows) =>
                rows.length ? (
                  <KillList kills={rows} showServer />
                ) : (
                  <div className="p-8 text-center text-muted">Quiet.</div>
                )
              }
            </Section>
          </Panel>
        </div>
      </Container>
    </>
  );
}
