import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyButton } from '@/components/client';
import { KillList } from '@/components/game';
import { Avatar, PlayerLink } from '@/components/player';
import { safe } from '@/components/section';
import { Badge, Container, Empty, FactionTag, Meter, Panel, Stat, StatGrid, StatusDot } from '@/components/ui';
import { ago, date, dateTime, duration, int, kd, metres, pct } from '@/lib/format';
import { causeInfo, mapName } from '@/lib/game';
import { getPlayer } from '@/lib/server/data';

const nowSec = () => Math.floor(Date.now() / 1000);

export async function generateMetadata({ params }: PageProps<'/players/[steamId]'>): Promise<Metadata> {
  const { steamId } = await params;
  if (!/^\d{17}$/.test(steamId)) return { title: 'Player not found' };
  const loaded = await safe(getPlayer(steamId));
  if (loaded === null) return { title: 'Player not found' };
  if (loaded instanceof Error) return { title: 'Player' };
  const p = loaded.data;
  return {
    title: p.name,
    description: `${p.name}: ${int(p.totals.kills)} kills, ${kd(p.totals.kills, p.totals.deaths)} K/D on TEG WARDOGS servers.`,
  };
}

type Group = { key: string; matches: number; wins: number; kills: number; deaths: number };

function GroupTable({ title, rows, label }: { title: string; rows: Group[]; label: (key: string) => string }) {
  return (
    <Panel title={title} flush>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{title.replace('By ', '')}</th>
                <th className="r">Matches</th>
                <th className="r">Wins</th>
                <th className="r">K/D</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key}>
                  <td className="font-medium">{label(g.key)}</td>
                  <td className="r text-muted">{int(g.matches)}</td>
                  <td className="r text-muted">{int(g.wins)}</td>
                  <td className="r font-semibold">{kd(g.kills, g.deaths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>None yet.</Empty>
      )}
    </Panel>
  );
}

export default async function PlayerPage({ params }: PageProps<'/players/[steamId]'>) {
  const { steamId } = await params;
  if (!/^\d{17}$/.test(steamId)) notFound();
  const loadedPlayer = await safe(getPlayer(steamId));
  if (loadedPlayer === null) notFound();
  if (loadedPlayer instanceof Error) {
    return (
      <Container className="mt-16">
        <Empty>Stats are temporarily unavailable. Try again in a minute.</Empty>
      </Container>
    );
  }
  const player = loadedPlayer.data;
  const t = player.totals;
  const weapons = player.weapons.slice(0, 15);
  const weaponKills = weapons.reduce((a, w) => a + w.kills, 0);
  const favourite = weapons[0];
  const servers = player.servers;
  const now = nowSec();

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
                    <Badge>Last seen {player.lastSeen ? ago(player.lastSeen, now) : '—'}</Badge>
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
                  <span className="text-xs">First seen {player.firstSeen ? date(player.firstSeen) : '—'}</span>
                </div>
              </div>
            </div>
            <div className="space-y-1 text-sm lg:text-right">
              {player.rank !== 'unavailable' && (
                <Link href="/leaderboards?metric=kills&period=all" className="link font-display text-lg font-semibold">
                  {player.rank ? `#${player.rank} on the all-time kills board` : 'Unranked'}
                </Link>
              )}
              {player.streak && (
                <div className="text-muted">
                  {player.streak.n} {player.streak.kind === 'win' ? 'wins' : 'losses'} in a row
                </div>
              )}
            </div>
          </div>
        </Container>
      </header>

      <Container className="mt-8 space-y-4">
        <StatGrid className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Kills" value={int(t.kills)} accent />
          <Stat label="Deaths" value={int(t.deaths)} />
          <Stat label="K/D" value={kd(t.kills, t.deaths)} />
          <Stat label="Headshot %" value={pct(t.headshots, t.kills)} sub={`${int(t.headshots)} headshots`} />
          <Stat label="Kills / hour" value={t.playtime ? ((t.kills * 3600) / t.playtime).toFixed(1) : '—'} />
          <Stat label="Longest kill" value={metres(t.longest)} />
          <Stat label="Playtime" value={duration(t.playtime)} />
          <Stat
            label="Rounds"
            value={int(t.matches)}
            sub={favourite ? `Main: ${causeInfo(favourite.cause).label}` : undefined}
          />
        </StatGrid>

        <div className="grid gap-4 lg:grid-cols-3">
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
          <GroupTable title="By map" rows={player.maps} label={mapName} />
          <GroupTable title="By faction" rows={player.factions} label={(k) => k} />
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
                    </tr>
                  </thead>
                  <tbody>
                    {weapons.map((w) => {
                      const info = causeInfo(w.cause);
                      return (
                        <tr key={w.cause}>
                          <td>
                            <span className="font-medium">{info.label}</span>
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
                ['Favourite targets', player.victims, 'kills'],
                ['Nemeses', player.nemeses, 'deaths'],
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
          {player.matches.length ? (
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
                  {player.matches.map((m) => (
                    <tr key={m.matchId}>
                      <td>
                        <Link href={`/matches/${m.serverId}/${m.matchId}`} className="link font-medium">
                          {mapName(m.map)}
                        </Link>
                        <div className="text-xs text-dim">{dateTime(m.startedAt)}</div>
                      </td>
                      <td className="text-muted">{m.serverName}</td>
                      <td>
                        {m.faction ? <FactionTag name={m.faction} /> : <span className="text-dim">—</span>}
                      </td>
                      <td className="r font-semibold">{m.kills}</td>
                      <td className="r text-muted">{m.deaths}</td>
                      <td className="r hidden text-muted sm:table-cell">{duration(m.timePlayed)}</td>
                      <td>
                        {!m.endedAt ? (
                          <Badge tone="good">Live</Badge>
                        ) : m.result === 'win' ? (
                          <Badge tone="accent">Won</Badge>
                        ) : m.result === 'loss' ? (
                          <Badge>Lost</Badge>
                        ) : m.result === 'draw' ? (
                          <Badge>Draw</Badge>
                        ) : (
                          <span className="text-dim">—</span>
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
            {player.recentKills.length ? <KillList kills={player.recentKills} showServer /> : <Empty>Nothing yet.</Empty>}
          </Panel>
          <Panel title="Known names" flush>
            <ul className="divide-y divide-line">
              {player.aliases.map((a) => (
                <li key={a} className="px-4 py-2.5 text-sm">
                  <span className="block truncate">{a}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </Container>
    </>
  );
}
