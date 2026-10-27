import type { Metadata } from 'next';
import Link from 'next/link';
import { FriendRow } from '@/components/friends';
import { FriendNewsPing } from '@/components/friend-news';
import { Avatar } from '@/components/avatar';
import { buttonClass, Container, Empty, PageHeader, Panel } from '@/components/ui';
import { ago } from '@/lib/format';
import { accounts, viewer } from '@/lib/server/accounts';
import { MAX_FRIENDS } from '@/lib/server/accounts/store';
import { friendsPage, friendTimes } from '@/lib/server/data';
import { FriendTimes } from '@/components/charts';
import { Section, safe } from '@/components/section';
import { one } from '@/lib/url';
import { answerFriendRequest, removeFriend, setHidePresence } from './actions';

export const metadata: Metadata = { title: 'Friends', robots: { index: false, follow: false } };

const DONE: Record<string, { text: string; good: boolean }> = {
  sent: { text: 'Friend request sent. You’ll be friends once they accept.', good: true },
  friends: { text: 'They’d already asked you, so you’re friends now.', good: true },
  accepted: { text: 'Request accepted: you’re friends now.', good: true },
  denied: { text: 'Request denied. They aren’t told.', good: true },
  removed: { text: 'Done.', good: true },
  hidden: { text: 'Hidden: only your friends see where you’re playing now.', good: true },
  visible: { text: 'Visible: everyone sees where you’re playing again.', good: true },
  limit: { text: `That’s the limit (${MAX_FRIENDS} friends, or 30 requests waiting at once).`, good: false },
  gone: { text: 'That request is no longer there.', good: false },
  'not-linked': { text: 'Only players who linked their Discord and Steam can be friends.', good: false },
};

function Person({ steamId, name, children }: { steamId: string; name: string | null; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Link prefetch={false} href={`/players/${steamId}`} className="link flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar name={name ?? '?'} steamId={steamId} size={28} />
        <span className="truncate font-medium">{name ?? 'A player'}</span>
      </Link>
      {children}
    </li>
  );
}

export default async function FriendsPage({ searchParams }: PageProps<'/friends'>) {
  const done = DONE[one((await searchParams).done) ?? ''];
  const a = accounts();
  const me = a ? await viewer() : null;
  const header = (
    <PageHeader
      eyebrow="You"
      title="Friends"
      description="Friends see where each other are playing, even if you hide it from everyone else. Add friends from their profiles; they accept or deny."
    />
  );

  if (!me?.steamId) {
    return (
      <>
        {header}
        <Container className="mt-8">
          <Panel>
            <p className="text-sm text-muted">
              Friends are for members who linked their Discord and Steam accounts, so both of you know who you&rsquo;re adding.{' '}
              {a ? (
                <Link href="/account" className="link text-accent">
                  {me ? 'Link your Steam account' : 'Sign in and link your accounts'}
                </Link>
              ) : (
                'Account linking isn’t switched on here.'
              )}
            </p>
          </Panel>
        </Container>
      </>
    );
  }

  const hidden = a!.store.byDiscord(me.discordId)?.hidePresence ?? false;
  const { friends, incoming, outgoing } = await friendsPage(me.discordId);
  const times = friends.length ? await safe(friendTimes(friends.map((f) => f.status.steamId))) : null;
  const names = Object.fromEntries(friends.map((f) => [f.status.steamId, f.status.name ?? 'A friend']));
  // Accepted since their last visit: marked on this visit; the page tells the store they're seen once it's showing.
  const fresh = new Set(a!.store.acceptedSince(me.discordId).map((r) => r.other));
  const sorted = [...friends].sort(
    (x, y) => Number(!!y.status.online) - Number(!!x.status.online) || (y.status.lastSeen ?? 0) - (x.status.lastSeen ?? 0),
  );

  return (
    <>
      {header}
      <Container className="mt-8 space-y-4">
        <FriendNewsPing stamp={`${incoming.length}|${friends.length}|${fresh.size}`} />
        {done && (
          <p role="status" className={`border px-4 py-3 text-sm ${done.good ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'}`}>
            {done.text}
          </p>
        )}

        <Panel title="Where you’re playing">
          <form action={setHidePresence} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="hide" value={hidden ? 'no' : 'yes'} />
            <p className="max-w-2xl text-sm text-muted">
              {hidden ? (
                <>
                  <span className="font-semibold text-text">Hidden.</span> Only your friends see which server you&rsquo;re on. Everyone else
                  sees &ldquo;Hidden player&rdquo; on scoreboards, kill feeds and rounds from the last 3 hours, and your profile doesn&rsquo;t say
                  where or when you last played. Your stats and leaderboard places still show. The game&rsquo;s own scoreboard isn&rsquo;t ours
                  to hide.
                </>
              ) : (
                <>
                  <span className="font-semibold text-text">Visible to everyone.</span> Hide it, and only your friends will see which server
                  you&rsquo;re on.
                </>
              )}
            </p>
            <button className={buttonClass(hidden ? 'secondary' : 'primary')}>{hidden ? 'Show to everyone' : 'Hide where I’m playing'}</button>
          </form>
        </Panel>

        {incoming.length > 0 && (
          <Panel title="Friend requests" flush action={`${incoming.length} waiting`}>
            <ul className="divide-y divide-line">
              {incoming.map((r) => (
                <Person key={r.steamId} steamId={r.steamId} name={r.name}>
                  <span className="text-xs text-dim">{ago(r.since)}</span>
                  <form action={answerFriendRequest}>
                    <input type="hidden" name="steamId" value={r.steamId} />
                    <input type="hidden" name="accept" value="yes" />
                    <button className={buttonClass('primary')}>Accept</button>
                  </form>
                  <form action={answerFriendRequest}>
                    <input type="hidden" name="steamId" value={r.steamId} />
                    <button className={buttonClass('secondary')}>Deny</button>
                  </form>
                </Person>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Friends" flush action={friends.length ? `${sorted.filter((f) => f.status.online).length} of ${friends.length} online` : undefined}>
          {sorted.length ? (
            <ul className="divide-y divide-line">
              {sorted.map((f) => (
                <FriendRow key={f.status.steamId} f={f.status} removable fresh={fresh.has(f.discordId)} />
              ))}
            </ul>
          ) : (
            <Empty>
              No friends yet. Find a player on the{' '}
              <Link href="/players" className="link text-accent">
                players page
              </Link>{' '}
              and press <span className="text-text">☆ Add friend</span> on their profile. They need a linked account too.
            </Empty>
          )}
        </Panel>

        {times && (
          <Panel title="When your friends play" action="Last 30 days">
            <Section loaded={times}>{(t) => <FriendTimes stretches={t} names={names} />}</Section>
          </Panel>
        )}

        {outgoing.length > 0 && (
          <Panel title="Requests you sent" flush>
            <ul className="divide-y divide-line">
              {outgoing.map((r) => (
                <Person key={r.steamId} steamId={r.steamId} name={r.name}>
                  <span className="text-xs text-dim">Sent {ago(r.since)}</span>
                  <form action={removeFriend}>
                    <input type="hidden" name="steamId" value={r.steamId} />
                    <button className="text-xs text-dim hover:text-bad">Cancel</button>
                  </form>
                </Person>
              ))}
            </ul>
          </Panel>
        )}
      </Container>
    </>
  );
}
