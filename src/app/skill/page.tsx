import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlayerLink } from '@/components/player';
import { Container, Empty, PageHeader, Pagination, Panel, RankCell, RankMove } from '@/components/ui';
import { ago, int } from '@/lib/format';
import { viewer } from '@/lib/server/accounts';
import { RANKED_MIN_ROUNDS, RATED_MIN_PEAK } from '@/lib/server/history/ratings';
import { SKILL_PAGE_SIZE, skillBoard } from '@/lib/server/trends';
import { one, pageParam, withParams } from '@/lib/url';

export const metadata: Metadata = {
  title: 'Skill rating',
  description: 'Season 2 skill ratings for TEG WARDOGS players, from who won the rounds they played.',
};

const nowSec = () => Math.floor(Date.now() / 1000);

export default async function SkillPage({ searchParams }: PageProps<'/skill'>) {
  const sp = await searchParams;
  const page = pageParam(one(sp.page));
  const [board, me] = await Promise.all([skillBoard(page).catch(() => null), viewer()]);
  if (board && page > 1 && (page - 1) * SKILL_PAGE_SIZE >= board.total) redirect(withParams('/skill', sp, { page: null }));
  const now = nowSec();
  const mine = me?.steamId ?? null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/leaderboards" className="link text-muted">
            Leaderboards
          </Link>
        }
        title="Skill rating"
        description="Who wins rounds, not just who gets kills. Every Season 2 round moves your rating by whether your side won, how strong both sides were, and how much of the round you played."
      />
      <Container className="mt-8 space-y-4">
        <Panel
          title="Season 2"
          flush
          action={board ? `${int(board.total)} ranked · ${int(board.rated)} rated` : undefined}
        >
          {!board ? (
            <Empty>Ratings aren&rsquo;t available right now.</Empty>
          ) : !board.rows.length ? (
            <Empty>Ratings are still being worked out from this season&rsquo;s rounds. Check back in a few minutes.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-20">Rank</th>
                      <th>Player</th>
                      <th className="r !text-accent">Rating</th>
                      <th className="r">Rounds</th>
                      <th className="r hidden sm:table-cell">Last played</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.rows.map((r) => (
                      <tr key={r.steamId} className={r.steamId === mine ? 'bg-accent-soft' : undefined}>
                        <td className="whitespace-nowrap">
                          <RankCell rank={r.rank} />
                          <RankMove moved={r.moved} since="a week ago" />
                        </td>
                        <td className="max-w-64">
                          <PlayerLink steamId={r.steamId} name={r.name} avatarUrl={r.avatarUrl} />
                        </td>
                        <td className="r font-display text-base font-bold text-text">{int(r.rating)}</td>
                        <td className="r text-muted">{int(r.rounds)}</td>
                        <td className="r hidden text-dim sm:table-cell">{ago(r.lastPlayed, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pages={Math.ceil(board.total / SKILL_PAGE_SIZE)} href={(p) => withParams('/skill', sp, { page: p })} />
            </>
          )}
        </Panel>

        <Panel title="How it works">
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm text-muted">
            <li>
              Everyone starts at <span className="text-text">1,000</span>. Winning against strong sides lifts you more than winning against weak
              ones, and losing to a weaker side costs more.
            </li>
            <li>
              A side&rsquo;s strength is the skill of everyone on it, so playing on the smaller team and winning counts for a lot.
            </li>
            <li>You&rsquo;re rated for the share of the round you played: joining for the last ten minutes moves you a little.</li>
            <li>
              The number is a careful estimate: it starts low while the site learns how good you are, then settles. It takes{' '}
              {RANKED_MIN_ROUNDS} rated rounds to appear here.
            </li>
            <li>Rounds that never reached {RATED_MIN_PEAK} players aren&rsquo;t rated, nor are stays under two minutes.</li>
          </ul>
        </Panel>
      </Container>
    </>
  );
}
