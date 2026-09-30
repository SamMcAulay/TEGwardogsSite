import Link from 'next/link';
import { AreaChart } from '@/components/charts';
import { AutoRefresh } from '@/components/client';
import { KillList, MapBackdrop, ServerCard } from '@/components/game';
import { PlayerLink } from '@/components/player';
import { Container, Meter, Panel, PanelLink, RankCell, Stat, StatGrid } from '@/components/ui';
import { compact, int, kd, metres, pct } from '@/lib/format';
import { causeLabel, factionColor } from '@/lib/game';
import { nowSec } from '@/lib/server/db';
import {
  factionWins,
  getServers,
  leaderboard,
  longestKills,
  networkSummary,
  periodStartTs,
  population,
  recentKills,
  weaponStats,
  type LeaderRow,
} from '@/lib/server/queries';

function MiniBoard({
  title,
  rows,
  value,
  href,
}: {
  title: string;
  rows: LeaderRow[];
  value: (r: LeaderRow) => string;
  href: string;
}) {
  return (
    <Panel title={title} action={<PanelLink href={href}>Full board</PanelLink>} flush>
      <ol className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.steamId} className="flex items-center gap-3 px-4 py-2.5">
            <RankCell rank={r.rank} />
            <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} className="flex-1 text-sm" />
            <span className="num font-display text-[15px] font-bold">{value(r)}</span>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-8 text-center text-sm text-muted">No data yet.</li>}
      </ol>
    </Panel>
  );
}

export default function Home() {
  const servers = getServers();
  const summary = networkSummary(servers);
  const now = nowSec();
  const pop = population(null, now - 86400, 600);
  const week = periodStartTs('7d');
  const kills = leaderboard({ metric: 'kills', period: '7d', limit: 5 }).rows;
  const kdBoard = leaderboard({ metric: 'kd', period: '7d', limit: 5 }).rows;
  const longest = longestKills(week, 5);
  const feed = recentKills({ limit: 12 });
  const weapons = weaponStats('7d').slice(0, 8);
  const wins = factionWins(null, week);
  const totalWins = wins.reduce((a, w) => a + w.wins, 0);

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
            <Stat
              label="Players online"
              value={int(summary.playersOnline)}
              sub={`of ${int(summary.capacity)} slots`}
              accent
            />
            <Stat label="Servers online" value={`${summary.serversOnline}/${summary.serversTotal}`} sub="TEG network" />
            <Stat
              label="Kills today"
              value={compact(summary.killsToday)}
              sub={`${int(summary.matchesToday)} matches`}
            />
            <Stat
              label="Players today"
              value={int(summary.playersToday)}
              sub={`${int(summary.totalPlayers)} tracked all-time`}
            />
          </StatGrid>
        </Container>
      </section>

      <Container className="mt-10 space-y-10">
        <section>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="display text-2xl">Live servers</h2>
            <PanelLink href="/servers">All servers</PanelLink>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {servers.map((s) => (
              <ServerCard key={s.id} server={s} />
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Network population · 24h"
            action={<span className="num">Peak today {int(summary.peakToday)}</span>}
            className="lg:col-span-2"
          >
            <AreaChart points={pop.map((p) => ({ t: p.ts, v: p.players }))} height={220} unit=" players" />
          </Panel>
          <Panel title="Faction wins · 7 days">
            <div className="space-y-4">
              {wins.map((w) => (
                <div key={w.faction}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="font-display text-sm font-semibold uppercase tracking-[0.1em]">{w.faction}</span>
                    <span className="num text-sm">
                      <span className="font-semibold">{int(w.wins)}</span>
                      <span className="ml-2 text-muted">{pct(w.wins, totalWins, 0)}</span>
                    </span>
                  </div>
                  <Meter value={w.wins} max={totalWins} color={factionColor(w.faction)} />
                </div>
              ))}
              {!wins.length && <div className="py-8 text-center text-sm text-muted">No finished matches yet.</div>}
              <p className="pt-2 text-xs text-dim">Rounds won across all servers, matches with at least two players.</p>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <MiniBoard
            title="Most kills · 7d"
            rows={kills}
            value={(r) => int(r.kills)}
            href="/leaderboards?metric=kills"
          />
          <MiniBoard
            title="Best K/D · 7d"
            rows={kdBoard}
            value={(r) => kd(r.kills, r.deaths)}
            href="/leaderboards?metric=kd"
          />
          <Panel
            title="Longest kills · 7d"
            action={<PanelLink href="/leaderboards?metric=longest">Full board</PanelLink>}
            flush
          >
            <ol className="divide-y divide-line">
              {longest.map((k, i) => (
                <li key={k.eventId} className="flex items-center gap-3 px-4 py-2.5">
                  <RankCell rank={i + 1} />
                  <div className="min-w-0 flex-1">
                    <PlayerLink steamId={k.killerSteamId} name={k.killerName} avatar={false} className="text-sm" />
                    <div className="truncate text-xs text-dim">{causeLabel(k.cause)}</div>
                  </div>
                  <span className="num font-display text-[15px] font-bold">{metres(k.distance)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Live kill feed"
            action={<PanelLink href="/feed">Open feed</PanelLink>}
            flush
            className="lg:col-span-2"
          >
            {feed.length ? (
              <KillList kills={feed} showServer />
            ) : (
              <div className="p-8 text-center text-muted">Quiet.</div>
            )}
          </Panel>
          <Panel title="Weapon meta · 7d" action={<PanelLink href="/weapons">All weapons</PanelLink>} flush>
            <ul className="divide-y divide-line">
              {weapons.map((w) => (
                <li key={w.cause}>
                  <Link
                    href={`/weapons/${encodeURIComponent(w.cause)}`}
                    className="block px-4 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-medium">{causeLabel(w.cause)}</span>
                      <span className="num text-muted">
                        <span className="font-semibold text-text">{compact(w.kills)}</span> kills
                      </span>
                    </div>
                    <Meter value={w.kills} max={weapons[0].kills} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </Container>
    </>
  );
}
