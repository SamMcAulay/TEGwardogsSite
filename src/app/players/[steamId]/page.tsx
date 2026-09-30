import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts';
import { CopyButton } from '@/components/client';
import { KillList } from '@/components/game';
import { Avatar, PlayerLink } from '@/components/player';
import { Badge, Container, Empty, FactionTag, Meter, Panel, Stat, StatGrid, StatusDot, cx } from '@/components/ui';
import { ago, date, dateTime, duration, int, kd, metres, ordinal, pct } from '@/lib/format';
import { causeInfo, mapName } from '@/lib/game';
import {
  getPlayer,
  playerDaily,
  playerMatches,
  playerRank,
  playerRivals,
  playerServers,
  playerTotals,
  playerWeapons,
  recentKills,
  type Metric,
} from '@/lib/server/queries';

export async function generateMetadata({ params }: PageProps<'/players/[steamId]'>): Promise<Metadata> {
  const { steamId } = await params;
  const p = /^\d{17}$/.test(steamId) ? getPlayer(steamId) : null;
  if (!p) return { title: 'Player not found' };
  return {
    title: p.name,
    description: `${p.name}: ${int(p.totals.kills)} kills, ${kd(p.totals.kills, p.totals.deaths)} K/D on TEG WARDOGS servers.`,
  };
}

const RANKED: { metric: Metric; label: string }[] = [
  { metric: 'kills', label: 'Kills' },
  { metric: 'kd', label: 'K/D' },
  { metric: 'headshots', label: 'Headshots' },
  { metric: 'playtime', label: 'Playtime' },
];

function Delta({ now, before, digits = 2 }: { now: number; before: number; digits?: number }) {
  const d = now - before;
  if (!Number.isFinite(d) || Math.abs(d) < Math.pow(10, -digits)) return null;
  return (
    <span className={cx('num', d > 0 ? 'text-good' : 'text-bad')}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(digits)}
    </span>
  );
}

export default async function PlayerPage({ params }: PageProps<'/players/[steamId]'>) {
  const { steamId } = await params;
  if (!/^\d{17}$/.test(steamId)) notFound();
  const player = getPlayer(steamId);
  if (!player) notFound();

  const t = player.totals;
  const week = playerTotals(steamId, '7d');
  const ranks = RANKED.map((r) => ({ ...r, rank: playerRank(steamId, r.metric, 'all') }));
  const daily = playerDaily(steamId, 30);
  const weapons = playerWeapons(steamId, 0, 15);
  const weaponKills = weapons.reduce((a, w) => a + w.kills, 0);
  const rivals = playerRivals(steamId);
  const servers = playerServers(steamId);
  const matches = playerMatches(steamId, 12);
  const kills = recentKills({ steamId, limit: 15 });
  const favourite = weapons[0];
  const lifetimeKd = t.kills / Math.max(1, t.deaths);
  const weekKd = week.kills / Math.max(1, week.deaths);

  return (
    <>
      <header className="grid-bg border-b border-line">
        <Container className="py-10">
          <div className="eyebrow mb-5">
            <Link href="/players" className="link text-muted">
              Players
            </Link>
            <span className="mx-2 text-dim">/</span>Profile
          </div>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-center gap-5">
              <Avatar
                name={player.name}
                steamId={steamId}
                url={player.avatarUrl}
                size={84}
                className="border border-line-strong"
              />
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {player.onlineOn ? (
                    <Link href={`/servers/${player.onlineOn.serverId}`}>
                      <Badge tone="good">
                        <StatusDot online /> Playing on {player.onlineOn.serverName}
                      </Badge>
                    </Link>
                  ) : (
                    <Badge>Last seen {ago(player.lastSeen)}</Badge>
                  )}
                  {player.onlineOn && (
                    <Badge>
                      <FactionTag name={player.onlineOn.live.faction} />
                    </Badge>
                  )}
                </div>
                <h1 className="display truncate text-4xl leading-none sm:text-5xl">{player.name}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                  <span className="font-mono text-xs">{steamId}</span>
                  <CopyButton value={steamId} label="Copy ID" />
                  <a
                    href={`https://steamcommunity.com/profiles/${steamId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link text-xs text-muted"
                  >
                    Steam profile ↗
                  </a>
                  <span className="text-xs">First seen {date(player.firstSeen)}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
              {ranks.map((r) => (
                <Link
                  key={r.metric}
                  href={`/leaderboards?metric=${r.metric}&period=all`}
                  className="bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <div className="eyebrow !text-[0.62rem]">{r.label} rank</div>
                  <div className="display num mt-1 text-2xl leading-none">{r.rank ? ordinal(r.rank.rank) : '—'}</div>
                  <div className="mt-1 text-[11px] text-dim">
                    {r.rank
                      ? `of ${int(r.rank.of)} · top ${Math.max(1, Math.ceil((r.rank.rank / r.rank.of) * 100))}%`
                      : 'Unranked'}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </Container>
      </header>

      <Container className="mt-8 space-y-4">
        <StatGrid className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Kills" value={int(t.kills)} sub={`${int(week.kills)} this week`} accent />
          <Stat label="Deaths" value={int(t.deaths)} sub={`${int(week.deaths)} this week`} />
          <Stat
            label="K/D"
            value={kd(t.kills, t.deaths)}
            sub={
              week.kills + week.deaths > 0 ? (
                <>
                  7d {weekKd.toFixed(2)} <Delta now={weekKd} before={lifetimeKd} />
                </>
              ) : (
                'No games this week'
              )
            }
          />
          <Stat label="Headshot %" value={pct(t.headshots, t.kills)} sub={`${int(t.headshots)} headshots`} />
          <Stat label="Kills / hour" value={t.playtime ? ((t.kills * 3600) / t.playtime).toFixed(1) : '—'} />
          <Stat label="Longest kill" value={metres(t.longest)} />
          <Stat label="Playtime" value={duration(t.playtime)} sub={`${duration(week.playtime)} this week`} />
          <Stat
            label="Rounds"
            value={int(t.matches)}
            sub={favourite ? `Main: ${causeInfo(favourite.cause).label}` : undefined}
          />
        </StatGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Activity · 30 days" className="lg:col-span-2">
            <BarChart
              bars={daily.map((d) => ({
                label: d.day.slice(5).split('-').reverse().join('/'),
                value: d.kills,
                detail: `${int(d.kills)} kills · ${int(d.deaths)} deaths · ${duration(d.playtime)}`,
              }))}
              height={160}
            />
          </Panel>
          <Panel title="Servers played" flush>
            <ul className="divide-y divide-line">
              {servers.map((s) => (
                <li key={s.serverId} className="px-4 py-3">
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <Link href={`/servers/${s.serverId}`} className="link font-medium">
                      {s.name}
                    </Link>
                    <span className="num text-muted">
                      {duration(s.playtime)} · {int(s.kills)} kills
                    </span>
                  </div>
                  <Meter value={s.playtime} max={servers[0].playtime} />
                </li>
              ))}
              {!servers.length && <Empty>No time recorded.</Empty>}
            </ul>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Weapons" flush className="lg:col-span-2" action={<span>Kill feed · all time</span>}>
            {weapons.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Weapon</th>
                      <th className="hidden w-40 sm:table-cell">Share</th>
                      <th className="r">Kills</th>
                      <th className="r">HS %</th>
                      <th className="r hidden sm:table-cell">Avg dist.</th>
                      <th className="r">Longest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weapons.map((w) => {
                      const info = causeInfo(w.cause);
                      return (
                        <tr key={w.cause}>
                          <td>
                            <Link href={`/weapons/${encodeURIComponent(w.cause)}`} className="link font-medium">
                              {info.label}
                            </Link>
                            <span className="ml-2 text-xs text-dim capitalize">{info.kind}</span>
                          </td>
                          <td className="hidden sm:table-cell">
                            <div className="flex items-center gap-2">
                              <Meter value={w.kills} max={weapons[0].kills} />
                              <span className="num w-10 text-right text-xs text-muted">
                                {pct(w.kills, weaponKills, 0)}
                              </span>
                            </div>
                          </td>
                          <td className="r font-semibold">{int(w.kills)}</td>
                          <td className="r text-muted">{pct(w.headshots, w.kills)}</td>
                          <td className="r hidden text-muted sm:table-cell">{metres(w.avgDistance)}</td>
                          <td className="r text-muted">{metres(w.longest)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No kill feed data for this player.</Empty>
            )}
          </Panel>
          <div className="grid gap-4">
            {(
              [
                ['Favourite targets', rivals.victims, 'kills'],
                ['Nemeses', rivals.nemeses, 'deaths'],
              ] as const
            ).map(([title, list, unit]) => (
              <Panel key={title} title={title} flush>
                <ul className="divide-y divide-line">
                  {list.map((r) => (
                    <li key={r.steamId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <PlayerLink steamId={r.steamId} name={r.name} className="text-sm" />
                      <span className="num shrink-0 text-sm">
                        <span className="font-semibold">{r.count}</span> <span className="text-muted">{unit}</span>
                      </span>
                    </li>
                  ))}
                  {!list.length && <Empty>None yet.</Empty>}
                </ul>
              </Panel>
            ))}
          </div>
        </div>

        <Panel title="Recent rounds" flush>
          {matches.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Server</th>
                    <th>Faction</th>
                    <th className="r">Kills</th>
                    <th className="r">Deaths</th>
                    <th className="r hidden sm:table-cell">Time</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.matchId}>
                      <td>
                        <Link href={`/matches/${m.matchId}`} className="link font-medium">
                          {mapName(m.map)}
                        </Link>
                        <div className="text-xs text-dim">{dateTime(m.startedAt)}</div>
                      </td>
                      <td className="text-muted">{m.serverName}</td>
                      <td>
                        <FactionTag name={m.faction} />
                      </td>
                      <td className="r font-semibold">{m.kills}</td>
                      <td className="r text-muted">{m.deaths}</td>
                      <td className="r hidden text-muted sm:table-cell">{duration(m.timePlayed)}</td>
                      <td>
                        {!m.endedAt ? (
                          <Badge tone="good">Live</Badge>
                        ) : !m.winner ? (
                          <span className="text-dim">—</span>
                        ) : m.winner === m.faction ? (
                          <Badge tone="accent">Won</Badge>
                        ) : (
                          <Badge>Lost</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No rounds recorded.</Empty>
          )}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Recent kills & deaths" flush className="lg:col-span-2">
            {kills.length ? <KillList kills={kills} showServer /> : <Empty>Nothing yet.</Empty>}
          </Panel>
          <Panel title="Known names" flush>
            <ul className="divide-y divide-line">
              {player.aliases.map((a) => (
                <li key={a.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-xs text-dim">{ago(a.lastSeen)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </Container>
    </>
  );
}
