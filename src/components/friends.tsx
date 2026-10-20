// Friends between linked members: requests, accepted friends and where they're playing. Server
// components; the buttons post to app/friends/actions.ts.
import Link from 'next/link';
import { answerFriendRequest, removeFriend, sendFriendRequest } from '@/app/friends/actions';
import { ago, int } from '@/lib/format';
import type { Relation } from '@/lib/server/accounts/store';
import type { FriendStatus } from '@/lib/server/views';
import { Avatar } from './avatar';
import { cx, StatusDot } from './ui';

const BUTTON = 'border px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors';
const QUIET = cx(BUTTON, 'border-line-strong text-muted hover:border-accent hover:text-accent');
const ON = cx(BUTTON, 'border-accent bg-accent-soft text-accent');

/** The friend control on a profile, for how the viewer stands with that player. */
export function FriendButton({
  steamId,
  relation,
  signedIn,
}: {
  steamId: string;
  relation: Relation;
  /** the viewer has a linked account (and so can have friends) */
  signedIn: boolean;
}) {
  const back = `/players/${steamId}`;
  if (!signedIn) {
    return (
      <Link href="/account" className={QUIET} title="Friends need a linked Discord and Steam account">
        ☆ Add friend
      </Link>
    );
  }
  if (relation === 'friends') {
    return (
      <Link href="/friends" className={ON} title="You're friends: see them on your friends page">
        ★ Friends
      </Link>
    );
  }
  if (relation === 'incoming') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-muted">Wants to be friends</span>
        <form action={answerFriendRequest}>
          <input type="hidden" name="steamId" value={steamId} />
          <input type="hidden" name="accept" value="yes" />
          <input type="hidden" name="back" value={back} />
          <button className={ON}>Accept</button>
        </form>
        <form action={answerFriendRequest}>
          <input type="hidden" name="steamId" value={steamId} />
          <input type="hidden" name="back" value={back} />
          <button className={QUIET}>Deny</button>
        </form>
      </span>
    );
  }
  if (relation === 'outgoing') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className={cx(BUTTON, 'border-line text-dim')}>Request sent</span>
        <form action={removeFriend}>
          <input type="hidden" name="steamId" value={steamId} />
          <input type="hidden" name="back" value={back} />
          <button className="text-xs text-dim hover:text-bad">Cancel</button>
        </form>
      </span>
    );
  }
  return (
    <form action={sendFriendRequest}>
      <input type="hidden" name="steamId" value={steamId} />
      <input type="hidden" name="back" value={back} />
      <button className={QUIET} title="Send a friend request. Friends see where each other are playing.">
        ☆ Add friend
      </button>
    </form>
  );
}

/** One friend: where they're playing now, or when last seen. */
export function FriendRow({ f, removable }: { f: FriendStatus; removable?: boolean }) {
  const name = f.name ?? 'Unknown player';
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
      <Link prefetch={false} href={`/players/${f.steamId}`} className="link flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar name={name} steamId={f.steamId} url={f.avatarUrl} size={28} />
        <span className="truncate font-medium">{name}</span>
      </Link>
      {f.online ? (
        <Link href={`/servers/${f.online.serverSlug}`} className="link inline-flex items-center gap-2 text-sm">
          <StatusDot online />
          <span className="text-text">{f.online.serverName}</span>
          <span className="text-muted">
            · {f.online.faction} · {int(f.online.kills)}/{int(f.online.deaths)}
          </span>
        </Link>
      ) : (
        <span className="text-sm text-muted">{f.lastSeen ? `Last seen ${ago(f.lastSeen)}` : 'Not seen lately'}</span>
      )}
      {removable && (
        <form action={removeFriend}>
          <input type="hidden" name="steamId" value={f.steamId} />
          <button className="text-xs text-dim hover:text-bad" aria-label={`Remove ${name} from your friends`}>
            Remove
          </button>
        </form>
      )}
    </li>
  );
}

/** "Friends online" on the home page; nothing when none are playing. */
export function FriendsOnline({ friends }: { friends: FriendStatus[] }) {
  const online = friends.filter((f) => f.online);
  if (!online.length) return null;
  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <h2 className="display text-[15px] tracking-[0.06em] text-text">Friends online</h2>
        <Link href="/friends" className="text-xs text-muted hover:text-accent">
          All friends →
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {online.map((f) => (
          <FriendRow key={f.steamId} f={f} />
        ))}
      </ul>
    </section>
  );
}
