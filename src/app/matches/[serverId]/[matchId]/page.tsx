import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/client';
import { FactionScores, KillList, MapBackdrop } from '@/components/game';
import { PlayerLink } from '@/components/player';
import { safe } from '@/components/section';
import { Badge, Container, Empty, Meter, Panel, Stat, StatGrid } from '@/components/ui';
import { dateTime, duration, int, kd, metres, money } from '@/lib/format';
import { causeLabel, factionColor, lightingName, mapName } from '@/lib/game';
import { getMatch } from '@/lib/server/data';
import type { MatchPlayerRow } from '@/lib/server/views';

const nowSec = () => Math.floor(Date.now() / 1000);

export async function generateMetadata({ params }: PageProps<'/matches/[serverId]/[matchId]'>): Promise<Metadata> {
  const { serverId, matchId } = await params;
  const id = Number(matchId);
  if (!Number.isInteger(id) || id < 1) return { title: 'Match not found' };
  const loaded = await safe(getMatch(serverId, id));
  if (loaded === null) return { title: 'Match not found' };
  if (loaded instanceof Error) return { title: 'Match' };
  const m = loaded.data.match;
  return { title: `${mapName(m.map)} on ${m.serverName}` };
}

/** Score over time, one line per faction on a shared scale. */
function ScoreTimeline({
  timeline,
  factions,
}: {
  timeline: number[][];
  factions: { name: string; colorHex: string | null }[];
}) {
  const W = 100;
  const H = 100;
  const t1 = Math.max(1, timeline[timeline.length - 1][0]);
  const max = Math.max(1, ...timeline.flatMap((r) => r.slice(1)));
  const x = (t: number) => (t / t1) * W;
  const y = (v: number) => H - (v / max) * H;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        {factions.map((f) => (
          <span key={f.name} className="flex items-center gap-1.5">
            <span className="h-2 w-2" style={{ background: factionColor(f.name, f.colorHex ?? undefined) }} />
            {f.name}{' '}
            <span className="num text-text">{timeline[timeline.length - 1][factions.indexOf(f) + 1] ?? 0}</span>
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[150px] w-full"
        role="img"
        aria-label="Score over time"
      >
        {factions.map((f, i) => (
          <polyline
            key={f.name}
            fill="none"
            stroke={factionColor(f.name, f.colorHex ?? undefined)}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            points={timeline.map((r) => `${x(r[0]).toFixed(2)},${y(r[i + 1] ?? 0).toFixed(2)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-dim">
        <span>{duration(timeline[0][0])}</span>
        <span>{duration(t1)}</span>
      </div>
    </div>
  );
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

export default async function MatchPage({ params }: PageProps<'/matches/[serverId]/[matchId]'>) {
  const { serverId, matchId } = await params;
  const id = Number(matchId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const loadedMatch = await safe(getMatch(serverId, id));
  if (loadedMatch === null) notFound();
  if (loadedMatch instanceof Error)
    return (
      <Container className="mt-16">
        <Empty>Stats are temporarily unavailable. Try again in a minute.</Empty>
      </Container>
    );
  const { match, lines, timeline, factions, awards, kills, weapons } = loadedMatch.data;
  const now = nowSec();

  const teams = factions.length
    ? factions.map((f) => f.name)
    : [...new Set(lines.map((l) => l.faction).filter((f): f is string => !!f))];
  const totalKills = lines.reduce((a, r) => a + r.kills, 0);
  const headshots = lines.reduce((a, r) => a + r.headshots, 0);
  const longest = lines.reduce((a, r) => (r.longest > (a?.longest ?? 0) ? r : a), null as MatchPlayerRow | null);
  const mvp = [...lines].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
  const live = !match.endedAt;
  const feed = kills.slice(0, 25);

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
            <FactionScores scores={match.scores} cap={null} />
          </div>
        </Container>
      </header>

      <Container className="mt-8 space-y-4">
        <StatGrid className="grid-cols-2 md:grid-cols-5">
          <Stat label="Players" value={int(lines.length)} sub={`Peak ${match.peakPlayers} at once`} />
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
          {teams.map((f) => (
            <TeamTable
              key={f}
              name={f}
              rows={lines.filter((r) => r.faction === f)}
              winner={!live && match.winner === f}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Score timeline" className="lg:col-span-2" action="Score by time into the round">
            {timeline.length > 1 ? (
              <ScoreTimeline timeline={timeline} factions={factions} />
            ) : (
              <Empty>{timeline.length ? 'Too short to chart.' : 'No score history for this round.'}</Empty>
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

        <Panel title="Awards" flush>
          {awards.length ? (
            <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
              {awards.map((a) => (
                <li key={a.key} className="px-4 py-3">
                  <div className="eyebrow !text-[0.66rem]">{a.label}</div>
                  <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                    <PlayerLink steamId={a.steamId} name={a.name} avatar={false} />
                    <span className="num font-semibold">{a.value}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No awards for this round.</Empty>
          )}
        </Panel>

        <Panel title="Kill feed" flush action={kills.length > 25 ? 'Latest 25' : undefined}>
          {feed.length ? <KillList kills={feed} /> : <Empty>No kill feed for this round.</Empty>}
        </Panel>
      </Container>
    </>
  );
}
