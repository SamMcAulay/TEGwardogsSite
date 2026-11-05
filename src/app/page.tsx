import Link from 'next/link';
import { AutoRefresh } from '@/components/client';
import { KillStack } from '@/components/game';
import { SectionTabs } from '@/components/section-tabs';
import { PlayerLink } from '@/components/player';
import { Section, safe } from '@/components/section';
import { ServerTabs } from '@/components/server-tabs';
import { TopDogs } from '@/components/top-dogs';
import { ClosenessChip, Container, Empty, Panel, PanelLink, RankCell, ScoreChips } from '@/components/ui';
import { int, kd } from '@/lib/format';
import { mapName } from '@/lib/game';
import { friendsByServer, toTabServer } from '@/lib/live';
import { viewer } from '@/lib/server/accounts';
import { endedRounds, friendsPage, getServers, leaderboard, recentKills, shortNameOf } from '@/lib/server/data';
import type { LeaderRow, Loaded } from '@/lib/server/views';

/** The signed-in member's friends with where they are; empty for everyone else. */
async function friendsOfViewer() {
  const me = await viewer();
  if (!me?.steamId) return [];
  return (await friendsPage(me.discordId).catch(() => null))?.friends.map((f) => f.status) ?? [];
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
  const [servers, myFriends, kdBoard, killsBoard, feed, ended] = await Promise.all([
    safe(getServers()),
    friendsOfViewer(),
    safe(leaderboard({ metric: 'kd', period: '7d' })),
    safe(leaderboard({ metric: 'kills', period: '7d' })),
    safe(recentKills({ limit: 8 })),
    safe(endedRounds()),
  ]);
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
          <div data-scene-gap aria-hidden className="h-[38vh] lg:h-auto lg:min-h-[calc(100vh-190px)]" />
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

        <div className="mt-6 grid items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
          <TopDogs kd={<Dogs loaded={kdBoard} value={(r) => kd(r.kills, r.deaths)} />} kills={<Dogs loaded={killsBoard} value={(r) => int(r.kills)} />} />
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
          <Panel title="Kill feed" action={<PanelLink href="/feed">Full feed</PanelLink>} flush>
            <Section loaded={feed}>{(k) => (k.length ? <KillStack kills={k} factionOf={factionOf} showServer /> : <Empty>Quiet.</Empty>)}</Section>
          </Panel>
        </div>
      </Container>
    </>
  );
}
