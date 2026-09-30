import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts';
import { AutoRefresh } from '@/components/client';
import { FactionScores, KillList, MapBackdrop } from '@/components/game';
import { PlayerLink } from '@/components/player';
import { Badge, Container, Empty, Meter, Panel, Stat, StatGrid } from '@/components/ui';
import { dateTime, duration, int, kd, metres, money } from '@/lib/format';
import { causeLabel, factionColor, lightingName, mapName } from '@/lib/game';
import { nowSec } from '@/lib/server/db';
import {
  getMatch,
  matchScoreboard,
  matchTimeline,
  matchWeapons,
  recentKills,
  type MatchPlayerRow,
} from '@/lib/server/queries';

export async function generateMetadata({ params }: PageProps<'/matches/[id]'>): Promise<Metadata> {
  const m = getMatch(Number((await params).id));
  return { title: m ? `${mapName(m.map)} on ${m.serverName}` : 'Match not found' };
}

function TeamTable({ name, rows, winner }: { name: string; rows: MatchPlayerRow[]; winner: boolean }) {
  const kills = rows.reduce((a, r) => a + r.kills, 0);
  const deaths = rows.reduce((a, r) => a + r.deaths, 0);
  return (
    <section className="panel min-w-0">
      <div
        className="flex items-center justify-between border-b border-line px-4 py-3"
        style={{ boxShadow: `inset 3px 0 0 ${factionColor(name)}` }}
      >
        <div className="flex items-center gap-2">
          <h2 className="display text-[15px] tracking-[0.06em]">{name}</h2>
          {winner && <Badge tone="accent">Winner</Badge>}
        </div>
        <span className="num text-xs text-muted">
          {rows.length} players · {int(kills)}/{int(deaths)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table !text-[13px]">
          <thead>
            <tr>
              <th>Player</th>
              <th className="r">K</th>
              <th className="r">D</th>
              <th className="r">K/D</th>
              <th className="r hidden sm:table-cell">HS</th>
              <th className="r hidden xl:table-cell">Cash</th>
              <th className="r">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.steamId}>
                <td className="max-w-40">
                  <PlayerLink steamId={r.steamId} name={r.name} avatar={false} />
                </td>
                <td className="r font-semibold">{r.kills}</td>
                <td className="r text-muted">{r.deaths}</td>
                <td className="r text-muted">{kd(r.kills, r.deaths)}</td>
                <td className="r hidden text-muted sm:table-cell">{r.headshots}</td>
                <td className="r hidden text-muted xl:table-cell">{money(r.cash)}</td>
                <td className="r text-dim">{duration(r.timePlayed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty>No players.</Empty>}
    </section>
  );
}

export default async function MatchPage({ params }: PageProps<'/matches/[id]'>) {
  const id = Number((await params).id);
  const match = Number.isInteger(id) ? getMatch(id) : null;
  if (!match) notFound();

  const now = nowSec();
  const board = matchScoreboard(id);
  const weapons = matchWeapons(id);
  const timeline = matchTimeline(id, 120);
  const feed = recentKills({ matchId: id, limit: 25 });
  const factions = match.scores.length ? match.scores.map((s) => s.name) : ['Valkyra', 'Lonestar', 'Manticore'];
  const totalKills = board.reduce((a, r) => a + r.kills, 0);
  const headshots = board.reduce((a, r) => a + r.headshots, 0);
  const longest = board.reduce((a, r) => (r.longest > (a?.longest ?? 0) ? r : a), null as MatchPlayerRow | null);
  const mvp = [...board].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
  const live = !match.endedAt;

  return (
    <>
      {live && <AutoRefresh seconds={10} />}
      <header className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 text-accent/20">
          <MapBackdrop map={match.map} />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/40" />
        </div>
        <Container className="relative grid gap-8 py-10 lg:grid-cols-[1fr_380px] lg:items-end">
          <div>
            <div className="eyebrow mb-3">
              <Link href="/matches" className="link text-muted">
                Matches
              </Link>
              <span className="mx-2 text-dim">/</span>
              <Link href={`/servers/${match.serverId}`} className="link text-muted">
                {match.serverName}
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="display text-5xl leading-none">{mapName(match.map)}</h1>
              {live ? <Badge tone="good">Live</Badge> : match.winner && <Badge tone="accent">{match.winner} won</Badge>}
            </div>
            <p className="mt-3 text-sm text-muted">
              King of the Hill · {lightingName(match.lighting)} · {dateTime(match.startedAt)} ·{' '}
              {duration((match.endedAt ?? now) - match.startedAt)}
            </p>
          </div>
          <div className="panel p-4">
            <FactionScores scores={match.scores} />
          </div>
        </Container>
      </header>

      <Container className="mt-8 space-y-4">
        <StatGrid className="grid-cols-2 md:grid-cols-5">
          <Stat label="Players" value={int(board.length)} sub={`Peak ${match.peakPlayers} at once`} />
          <Stat label="Kills" value={int(totalKills)} />
          <Stat label="Headshots" value={int(headshots)} />
          <Stat
            label="Top fragger"
            value={mvp ? mvp.kills : '—'}
            sub={mvp ? <PlayerLink steamId={mvp.steamId} name={mvp.name} avatar={false} /> : undefined}
            accent
          />
          <Stat
            label="Longest kill"
            value={longest ? metres(longest.longest) : '—'}
            sub={longest ? <PlayerLink steamId={longest.steamId} name={longest.name} avatar={false} /> : undefined}
          />
        </StatGrid>

        <div className="grid gap-4 xl:grid-cols-3">
          {factions.map((f) => (
            <TeamTable
              key={f}
              name={f}
              rows={board.filter((r) => r.faction === f)}
              winner={!live && match.winner === f}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Kill tempo" className="lg:col-span-2" action="Kills per 2 minutes">
            {timeline.length > 1 ? (
              <BarChart
                bars={timeline.map((b) => ({
                  label: duration(b.ts - match.startedAt < 0 ? 0 : b.ts - match.startedAt),
                  value: b.kills,
                  detail: `${b.kills} kills`,
                }))}
                height={150}
              />
            ) : (
              <Empty>{timeline.length ? 'Too short to chart.' : 'No kill feed for this round.'}</Empty>
            )}
          </Panel>
          <Panel title="Weapons used" flush>
            <ul className="divide-y divide-line">
              {weapons.map((w) => (
                <li key={w.cause} className="px-4 py-2.5">
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>{causeLabel(w.cause)}</span>
                    <span className="num font-semibold">{w.kills}</span>
                  </div>
                  <Meter value={w.kills} max={weapons[0].kills} />
                </li>
              ))}
              {!weapons.length && <Empty>No weapon data.</Empty>}
            </ul>
          </Panel>
        </div>

        <Panel title="Kill feed" flush action={feed.length === 25 ? 'Latest 25' : undefined}>
          {feed.length ? <KillList kills={feed} /> : <Empty>No kill feed for this round.</Empty>}
        </Panel>
      </Container>
    </>
  );
}
