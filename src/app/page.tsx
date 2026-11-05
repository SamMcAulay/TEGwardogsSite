import Link from 'next/link';
import type { ReactNode } from 'react';
import { AutoRefresh } from '@/components/client';
import { KillStack } from '@/components/game';
import { SectionTabs } from '@/components/section-tabs';
import { PlayerLink } from '@/components/player';
import { Section, safe } from '@/components/section';
import { ServerTabs } from '@/components/server-tabs';
import { TopDogs } from '@/components/top-dogs';
import { ClosenessChip, Container, Empty, Panel, PanelLink, RankCell, ScoreChips } from '@/components/ui';
import { compact, int, kd } from '@/lib/format';
import { mapName } from '@/lib/game';
import { friendsByServer, toTabServer } from '@/lib/live';
import { viewer } from '@/lib/server/accounts';
import { endedRounds, friendsPage, getServers, leaderboard, networkSummary, recentKills, records, shortNameOf } from '@/lib/server/data';
import { boardMoves } from '@/lib/server/trends';
import type { LeaderRow, Loaded } from '@/lib/server/views';

/** The signed-in member's friends with where they are; empty for everyone else. */
async function friendsOfViewer() {
  const me = await viewer();
  if (!me?.steamId) return [];
  return (await friendsPage(me.discordId).catch(() => null))?.friends.map((f) => f.status) ?? [];
}

function TodayStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <div className="display num text-3xl sm:text-4xl">{value}</div>
      <div className="mt-1 text-sm font-bold text-muted">{label}</div>
    </div>
  );
}

/** Small ranked list for the second row's cards. */
function MiniRows({ rows }: { rows: { steamId: string; name: string; avatarUrl: string | null; value: string; note?: ReactNode }[] }) {
  return (
    <ol className="grid gap-2">
      {rows.map((r, i) => (
        <li key={r.steamId} className="flex items-center gap-3">
          <RankCell rank={i + 1} />
          <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} className="min-w-0 flex-1 font-bold" />
          {r.note}
          <span className="display num text-xl">{r.value}</span>
        </li>
      ))}
    </ol>
  );
}

function Dogs({ loaded, value }: { loaded: Loaded<{ rows: LeaderRow[] }> | Error; value: (r: LeaderRow) => string }) {
  return (
    <Section loaded={loaded}>
      {({ rows }) =>
        rows.length ? (
          <ol className="grid gap-2">
            {rows.slice(0, 3).map((r) => (
              <li key={r.steamId} className="flex items-center gap-3">
                <RankCell rank={r.rank} large />
                <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} className="min-w-0 flex-1 text-base font-extrabold" />
                <span className="display num text-2xl">{value(r)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No rounds this week yet.</Empty>
        )
      }
    </Section>
  );
}

export default async function Home() {
  const [servers, myFriends, kdBoard, killsBoard, feed, ended, allTime, recs] = await Promise.all([
    safe(getServers()),
    friendsOfViewer(),
    safe(leaderboard({ metric: 'kd', period: '7d' })),
    safe(leaderboard({ metric: 'kills', period: '7d' })),
    safe(recentKills({ limit: 8 })),
    safe(endedRounds()),
    safe(leaderboard({ metric: 'kills', period: 'all' })),
    safe(records()),
  ]);
  // Without the server list there is no summary to give; never a row of zeros.
  const summary = servers instanceof Error ? servers : await safe(networkSummary(servers.data));
  // Biggest climbers on the all-time kills board this week, from the daily snapshots (top page only).
  const moves = allTime instanceof Error ? null : await boardMoves('kills', allTime.data.rows).catch(() => null);
  const climbers =
    allTime instanceof Error || !moves
      ? []
      : allTime.data.rows
          .map((r) => ({ r, up: moves.moved.get(r.steamId) ?? 0 }))
          .filter((x) => x.up > 0)
          .sort((a, b) => b.up - a.up)
          .slice(0, 3);
  const onlineFriends = myFriends.filter((f) => f.online);
  // Who's on which side right now, to colour the kill feed's names.
  const factionOf = Object.fromEntries((servers instanceof Error ? [] : servers.data).flatMap((s) => s.players.map((p) => [p.steamId, p.faction])));
  const recent = ended instanceof Error ? null : [...ended].sort((a, b) => b.endedAt - a.endedAt).slice(0, 4);

  return (
    <>
      <AutoRefresh seconds={15} />
      <Container className="pt-6">
        <SectionTabs section="live" current="home" />
        {/* The island shows through the gap on the left; the server tabs float on the right. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* The scene frames the island on this whole column; today's numbers float at its foot. */}
          <div className="relative flex min-h-[38vh] flex-col justify-end lg:min-h-[calc(100vh-190px)]">
            <div data-scene-gap aria-hidden className="absolute inset-0" />
            <Section loaded={summary}>
              {(sm) => (
                <section aria-label="Today on TEG" className="panel relative grid grid-cols-2 divide-dashed divide-line sm:grid-cols-4 sm:divide-x-2">
                  <TodayStat label="Kills today" value={compact(sm.killsToday)} />
                  <TodayStat label="Players today" value={int(sm.playersToday)} />
                  <TodayStat label="Rounds today" value={int(sm.matchesToday)} />
                  <TodayStat label="Busiest server peak" value={int(sm.peakToday)} />
                </section>
              )}
            </Section>
          </div>
          <Section loaded={servers}>
            {(list) => (
              <ServerTabs
                servers={list.map(toTabServer)}
                friends={friendsByServer(myFriends)}
                playing={list.reduce((a, s) => a + s.playerCount, 0)}
                up={list.filter((s) => s.online).length}
                total={list.length}
              />
            )}
          </Section>
        </div>

        {/* Three columns that each stack on their own, so a tall card never leaves a hole beside it. */}
        <div className="mt-6 grid items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-6">
            <TopDogs kd={<Dogs loaded={kdBoard} value={(r) => kd(r.kills, r.deaths)} />} kills={<Dogs loaded={killsBoard} value={(r) => int(r.kills)} />} />
            <Panel title="Busiest guns today" action={<PanelLink href="/records">Records</PanelLink>}>
              <Section loaded={recs}>
                {(r) =>
                  r.today.length ? (
                    <MiniRows rows={r.today.slice(0, 3).map((x) => ({ ...x, value: `${int(x.value)} kills` }))} />
                  ) : (
                    <Empty>No kills in the last 24 hours.</Empty>
                  )
                }
              </Section>
            </Panel>
          </div>
          <div className="grid gap-6">
            <Panel title="Just finished" action={<PanelLink href="/matches">All matches</PanelLink>}>
              {recent === null ? (
                <Empty>Stats are temporarily unavailable. Try again in a minute.</Empty>
              ) : recent.length ? (
                <ul className="divide-y-2 divide-dashed divide-line">
                  {recent.map((r) => (
                    <li key={`${r.serverId}-${r.matchId}`}>
                      <Link prefetch={false} href={`/matches/${r.serverId}/${r.matchId}`} className="flex items-center gap-3 py-3 font-semibold hover:text-accent">
                        <span className="min-w-0 flex-1 truncate">
                          {shortNameOf(r.serverName)} · {mapName(r.map)}
                        </span>
                        <ScoreChips scores={r.scores} />
                        <ClosenessChip scores={r.scores.map((s) => s.score)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No finished rounds yet.</Empty>
              )}
            </Panel>
            <Panel title="Climbing" action={<PanelLink href="/leaderboards?metric=kills&period=all">All-time board</PanelLink>}>
              {climbers.length ? (
                <MiniRows
                  rows={climbers.map(({ r, up }) => ({
                    steamId: r.steamId,
                    name: r.name,
                    avatarUrl: r.avatarUrl,
                    value: `#${r.rank}`,
                    note: <span className="num text-sm font-extrabold text-good">▲{up}</span>,
                  }))}
                />
              ) : (
                <Empty>Nobody has climbed the all-time board this week yet.</Empty>
              )}
            </Panel>
          </div>
          <div className="grid gap-6">
            <Panel title="Kill feed" action={<PanelLink href="/feed">Full feed</PanelLink>} flush>
              <Section loaded={feed}>{(k) => (k.length ? <KillStack kills={k} factionOf={factionOf} showServer /> : <Empty>Quiet.</Empty>)}</Section>
            </Panel>
            {onlineFriends.length > 0 && (
              <Panel title="Friends online" action={<PanelLink href="/friends">All friends</PanelLink>}>
                <ul className="grid gap-2">
                  {onlineFriends.map((f) => (
                    <li key={f.steamId} className="flex items-center gap-3">
                      <span className="size-2.5 shrink-0 rounded-full bg-good" aria-hidden />
                      <PlayerLink steamId={f.steamId} name={f.name ?? 'A friend'} avatarUrl={f.avatarUrl} className="min-w-0 flex-1 font-bold" />
                      <Link href={`/servers/${f.online!.serverSlug}`} className="text-sm font-bold text-muted hover:text-accent">
                        {f.online!.serverName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </Container>
    </>
  );
}
