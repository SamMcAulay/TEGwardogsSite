import type { Metadata } from 'next';
import { LocalTime } from '@/components/local-time';
import Link from 'next/link';
import { serverPath } from '@/lib/url';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/client';
import { FactionScores, KillList, MapBackdrop } from '@/components/game';
import { PlayerLink } from '@/components/player';
import { safe } from '@/components/section';
import { Badge, Container, Empty, Meter, Panel, Stat, StatGrid } from '@/components/ui';
import { duration, int, kd, metres, money } from '@/lib/format';
import { causeLabel, factionColor, lightingName, mapName } from '@/lib/game';
import { getMatch } from '@/lib/server/data';
import type { MatchPlayerRow } from '@/lib/server/views';
import type { Momentum } from '@/lib/momentum';

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

/** Kills per stretch of the round: the first faction's above the line, the second's below. */
function MomentumChart({ flow, factions }: { flow: Momentum; factions: { name: string; colorHex: string | null }[] }) {
  const [a, b] = factions;
  const max = Math.max(1, ...flow.buckets.flat());
  const n = flow.buckets.length;
  const W = 100;
  const H = 100;
  const bar = W / n;
  const half = (v: number) => (v / max) * (H / 2 - 2);
  const colour = (f: { name: string; colorHex: string | null }) => factionColor(f.name, f.colorHex ?? undefined);
  const mins = flow.bucketS / 60;
  const span = (i: number) => `${i * mins}–${(i + 1) * mins} min`;
  const swing = flow.swing && flow.buckets[flow.swing.index];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex flex-wrap gap-4">
          {[a, b].map((f, i) => (
            <span key={f.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2" style={{ background: colour(f) }} />
              {f.name} {i === 0 ? '↑' : '↓'}
            </span>
          ))}
        </span>
        {flow.swing && swing && (
          <span>
            Biggest swing: <span className="text-text">{span(flow.swing.index)}</span>, {factions[flow.swing.leader].name}{' '}
            <span className="num text-text">
              {swing[flow.swing.leader]}–{swing[1 - flow.swing.leader]}
            </span>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[160px] w-full" role="img" aria-label={`Kills every ${mins} minutes for each side`}>
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {flow.buckets.map(([ka, kb], i) => (
          <g key={i}>
            <title>{`${span(i)}: ${a.name} ${ka}, ${b.name} ${kb}`}</title>
            <rect x={i * bar + bar * 0.12} width={bar * 0.76} y={H / 2 - half(ka)} height={half(ka)} fill={colour(a)} opacity={flow.swing?.index === i ? 1 : 0.75} />
            <rect x={i * bar + bar * 0.12} width={bar * 0.76} y={H / 2} height={half(kb)} fill={colour(b)} opacity={flow.swing?.index === i ? 1 : 0.75} />
          </g>
        ))}
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-dim">
        <span>0 min</span>
        <span>
          {n * mins} min · {mins === 1 ? 'each bar a minute' : `each bar ${mins} minutes`}
        </span>
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
  const { match, lines, timeline, factions, awards, kills, weapons, momentum } = loadedMatch.data;
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
              <Link href={serverPath(match.serverName)} className="link text-muted">
                {match.serverName}
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="display text-5xl leading-none">{mapName(match.map)}</h1>
              {live ? <Badge tone="good">Live</Badge> : match.winner && <Badge tone="accent">{match.winner} won</Badge>}
            </div>
            <p className="mt-3 text-sm text-muted">
              King of the Hill · {lightingName(match.lighting)} · <LocalTime ts={match.startedAt} /> ·{' '}
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

        {momentum && factions.length === 2 && (
          <Panel title="Momentum" action="Kills by each side through the round; team kills not counted">
            <MomentumChart flow={momentum} factions={factions} />
          </Panel>
        )}

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
