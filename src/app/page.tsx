import {
  Heading,
  LastResult,
  LongestShot,
  LowerThird,
  Milestone,
  FriendsOn,
  Pic,
  Results,
  RoundSoFar,
  RunningOrder,
  Ticker,
  Tower,
} from '@/components/broadcast';
import { ClockAt, Feed, Standings, type Bug, type Segment } from '@/components/broadcast-feed';
import { AutoRefresh } from '@/components/client';
import { safe } from '@/components/section';
import { SectionTabs } from '@/components/section-tabs';
import { compact, int, kd } from '@/lib/format';
import { KOTH_CAP, lightingName, mapArt, mapName } from '@/lib/game';
import { viewer } from '@/lib/server/accounts';
import { endedRounds, friendsPage, getServers, leaderboard, networkSummary, recentKills, records, shortNameOf } from '@/lib/server/data';
import { homeFeed, scored } from '@/lib/server/feed';
import { boardMoves } from '@/lib/server/trends';
import type { LeaderRow, Loaded } from '@/lib/server/views';

/** The signed-in member's friends with where they are; empty for everyone else. */
async function friendsOfViewer() {
  const me = await viewer();
  if (!me?.steamId) return [];
  return (await friendsPage(me.discordId).catch(() => null))?.friends.map((f) => f.status) ?? [];
}

/** Unix seconds now; outside the component so render stays pure. */
const nowSec = () => Math.floor(Date.now() / 1000);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const inMinutes = (s: number | null) => (s == null ? 'later' : s < 90 ? 'any minute' : `in about ${Math.round(s / 60)} min`);

function board(loaded: Loaded<{ rows: LeaderRow[] }> | Error, value: (r: LeaderRow) => string) {
  if (loaded instanceof Error) return <p className="bc-empty">Stats are temporarily unavailable. Try again in a minute.</p>;
  return (
    <Tower
      empty="No rounds this week yet."
      rows={loaded.data.rows.slice(0, 8).map((r) => ({
        key: r.steamId,
        href: `/players/${r.steamId}`,
        name: r.name,
        pic: <Pic name={r.name} steamId={r.steamId} url={r.avatarUrl} size={34} />,
        value: value(r),
      }))}
    />
  );
}

export default async function Home() {
  const [servers, myFriends, kdBoard, killsBoard, kills, ended, allTime, recs] = await Promise.all([
    safe(getServers()),
    friendsOfViewer(),
    safe(leaderboard({ metric: 'kd', period: '7d' })),
    safe(leaderboard({ metric: 'kills', period: '7d' })),
    safe(recentKills({ limit: 12 })),
    safe(endedRounds()),
    safe(leaderboard({ metric: 'kills', period: 'all' })),
    safe(records()),
  ]);
  const list = servers instanceof Error ? [] : servers.data;
  const [summary, feed, moves] = await Promise.all([
    list.length ? safe(networkSummary(list)) : Promise.resolve(new Error('no servers')),
    homeFeed(list, recs instanceof Error ? null : recs.data),
    allTime instanceof Error ? null : boardMoves('kills', allTime.data.rows).catch(() => null),
  ]);
  const now = nowSec();

  // On air: servers that are up and say what they're playing, in the order Warcon lists them.
  const onAir = list.filter((s) => s.online && s.status);
  const bugs: Bug[] = onAir.map((s) => ({
    id: s.id,
    name: s.shortName,
    scores: s.status!.factionScores.map((f) => ({ name: f.name, score: f.score })),
    clock: feed.clock[s.id] ?? null,
    players: s.playerCount,
    max: s.status!.players.max ?? null,
  }));
  const artOf = (serverId: string | undefined) => {
    const st = onAir.find((s) => s.id === serverId)?.status ?? onAir[0]?.status;
    return st ? mapArt(mapName(st.map), st.lighting) : null;
  };

  const segments: Segment[] = onAir.map((s, n) => {
    const st = s.status!;
    const map = mapName(st.map);
    const clock = feed.clock[s.id];
    return {
      id: `live-${s.slug}`,
      label: `Live · ${s.shortName}`,
      sub: map,
      art: mapArt(map, st.lighting),
      cam: `CAM ${n + 1}`,
      source: s.name,
      where: [
        map,
        s.playerCount === 0 && feed.busyAt[s.id] ? (
          <>
            Quiet right now · usually busiest around <ClockAt ts={feed.busyAt[s.id]!} />
          </>
        ) : (
          [lightingName(st.lighting), clock != null && `round ${mmss(clock)}`, `${s.playerCount}/${st.players.max} playing`].filter(Boolean).join(' · ')
        ),
      ],
      bug: n,
      href: `/servers/${s.slug}`,
    };
  });
  const r = feed.roundSoFar;
  if (r) {
    const live = onAir.findIndex((s) => s.id === r.serverId);
    const st = onAir[live]?.status;
    segments.push({
      id: 'round',
      label: 'Round so far',
      sub: `${r.serverName} score race`,
      art: artOf(r.serverId),
      dim: true,
      cam: 'GFX',
      source: `${r.serverName} · round so far`,
      bug: live >= 0 ? live : undefined,
      body: <RoundSoFar round={r} cap={st?.scoreCap ?? KOTH_CAP} scores={st ? st.factionScores.map((f) => ({ name: f.name, score: f.score })) : r.scores} />,
    });
  }
  if (feed.longest) {
    segments.push({
      id: 'shot',
      label: 'Longest shot',
      sub: feed.longest.today ? 'today' : 'on record',
      art: artOf(feed.longest.shot.serverId),
      dim: true,
      cam: 'GFX',
      source: 'Records · longest shot',
      body: <LongestShot shot={feed.longest.shot} today={feed.longest.today} />,
    });
  }
  if (feed.lastResult) {
    const lr = feed.lastResult;
    segments.push({
      id: 'result',
      label: 'Last result',
      sub: lr.map,
      art: mapArt(lr.map, lr.lighting) ?? artOf(lr.serverId),
      dim: true,
      cam: 'GFX',
      source: `Final · ${lr.serverName}`,
      body: <LastResult round={lr} />,
    });
  }
  const nextOn = onAir.find((s) => feed.upNext[s.id]?.length);
  if (nextOn) {
    const [first, ...rest] = feed.upNext[nextOn.id];
    segments.push({
      id: 'next',
      label: 'Up next',
      sub: `${first.map} on ${nextOn.shortName}`,
      art: mapArt(first.map, first.lighting),
      cam: 'NEXT',
      source: `${nextOn.shortName} · up next`,
      where: [first.map, [lightingName(first.lighting), inMinutes(first.inSeconds), rest.length && `then ${rest.map((m) => m.map).join(', ')}`].filter(Boolean).join(' · ')],
      href: `/servers/${nextOn.slug}`,
    });
  }
  if (feed.milestone) {
    segments.push({
      id: 'milestone',
      label: 'Milestone watch',
      sub: feed.milestone.name,
      art: artOf(undefined),
      dim: true,
      cam: 'GFX',
      source: 'Milestones',
      body: <Milestone m={feed.milestone} />,
    });
  }
  const friendsOn = myFriends
    .filter((f) => f.online)
    .map((f) => ({ steamId: f.steamId, name: f.name ?? 'A friend', avatarUrl: f.avatarUrl, serverName: f.online!.serverName, serverSlug: f.online!.serverSlug }));
  if (friendsOn.length) {
    segments.push({
      id: 'friends',
      label: 'Your friends',
      sub: `${friendsOn.length} on now`,
      art: artOf(undefined),
      dim: true,
      cam: 'GFX',
      source: 'Friends on now',
      body: <FriendsOn friends={friendsOn} />,
    });
  }

  const top = feed.topToday;
  const recent = ended instanceof Error ? [] : ended.filter((m) => scored(m.scores)).sort((a, b) => b.endedAt - a.endedAt).slice(0, 4);
  const climbers =
    allTime instanceof Error || !moves
      ? []
      : allTime.data.rows
          .map((row) => ({ row, up: moves.moved.get(row.steamId) ?? 0 }))
          .filter((x) => x.up > 0)
          .sort((a, b) => b.up - a.up)
          .slice(0, 3);
  // Who's on which side right now, to colour the ticker's names.
  const factionOf = Object.fromEntries(list.flatMap((s) => s.players.map((p) => [p.steamId, p.faction])));

  return (
    <>
      <AutoRefresh seconds={15} />
      <div className="mx-auto max-w-[1480px] px-4 pt-2 md:px-[clamp(16px,2.4vw,32px)]">
        <h1 className="sr-only">TEG WARDOGS live: servers, rounds and stats</h1>
        <div className="mb-4">
          <SectionTabs section="live" current="home" />
        </div>
        <div className="bc-stage">
          {segments.length ? (
            <Feed bugs={bugs} segments={segments} lowerThird={top ? <LowerThird steamId={top.steamId} name={top.name} avatarUrl={top.avatarUrl} kills={top.value} /> : null} />
          ) : (
            <p className="bc-empty">The servers aren&apos;t answering right now. Try again in a minute.</p>
          )}
          <RunningOrder
            servers={onAir.map((s) => ({
              id: s.id,
              name: s.name,
              slug: s.slug,
              now: { map: mapName(s.status!.map), lighting: s.status!.lighting },
              next: (feed.upNext[s.id] ?? []).map((m) => ({ map: m.map, lighting: m.lighting, at: m.inSeconds == null ? null : now + m.inSeconds })),
            }))}
          />
        </div>
        <Ticker kills={kills instanceof Error ? [] : kills.data} factionOf={factionOf} />

        <div className="bc-wall">
          <section>
            <Heading title="Standings · last 7 days" href="/leaderboards" link="Leaderboards" />
            <Standings kills={board(killsBoard, (row) => int(row.kills))} kd={board(kdBoard, (row) => kd(row.kills, row.deaths))} />
          </section>
          <section>
            <Heading title="Latest results" href="/matches" link="All matches" />
            <Results rounds={recent.map((m) => ({ serverId: m.serverId, serverName: shortNameOf(m.serverName), matchId: m.matchId, map: mapName(m.map), scores: m.scores }))} />
            <div className="mt-[clamp(16px,2.4vw,32px)]">
              <Heading title="Climbing the all-time board · 7 days" href="/leaderboards?metric=kills&period=all" link="All-time board" />
              <Tower
                empty="Nobody has climbed the all-time board this week yet."
                rows={climbers.map(({ row, up }) => ({ key: row.steamId, href: `/players/${row.steamId}`, name: row.name, value: <span className="text-good">+{up}</span> }))}
              />
            </div>
          </section>
          <section>
            <Heading title="Last 24 hours" />
            {summary instanceof Error ? (
              <p className="bc-empty">Today&apos;s numbers are temporarily unavailable.</p>
            ) : (
              <div className="bc-stats">
                {[
                  [compact(summary.data.killsToday), 'Kills'],
                  [int(summary.data.playersToday), 'Players'],
                  [int(summary.data.matchesToday), 'Rounds'],
                  [int(summary.data.peakToday), 'Busiest peak'],
                ].map(([v, l]) => (
                  <div key={l} className="bc-st bc-plate">
                    <b className="num">{v}</b>
                    <small>{l}</small>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-[clamp(16px,2.4vw,32px)]">
              <Heading title="Most kills · 24 hours" href="/records" link="Records" />
              <Tower
                empty="No kills in the last 24 hours."
                rows={(recs instanceof Error ? [] : recs.data.today.slice(0, 3)).map((row) => ({ key: row.steamId, href: `/players/${row.steamId}`, name: row.name, value: int(row.value) }))}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
