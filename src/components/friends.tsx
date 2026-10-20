'use client';
// Friends: players a visitor follows, kept in this browser only (no account needed). Profiles have
// a button to add one; /friends and the home page show who is playing now.

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ago, int } from '@/lib/format';
import type { FriendStatus } from '@/lib/server/views';
import { Avatar } from './avatar';
import { cx, StatusDot } from './ui';

const KEY = 'teg-friends';
const CHANGED = 'teg-friends-changed';
const NONE: string[] = [];
let cache: { raw: string | null; list: string[] } = { raw: null, list: NONE };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return NONE;
  }
  if (raw === cache.raw) return cache.list;
  let list: string[] = NONE;
  try {
    const v = JSON.parse(raw ?? '[]');
    if (Array.isArray(v)) list = v.filter((x): x is string => typeof x === 'string' && /^\d{17}$/.test(x));
  } catch {}
  cache = { raw, list };
  return list;
}

function write(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The friends list (Steam ids, oldest first); empty on the server and before the browser takes over. */
export function useFriends(): string[] {
  return useSyncExternalStore(subscribe, read, () => NONE);
}

export const MAX_FRIENDS = 50;

/** Add or remove a player; at most MAX_FRIENDS. */
export function FriendButton({ steamId }: { steamId: string }) {
  const friends = useFriends();
  const on = friends.includes(steamId);
  const full = !on && friends.length >= MAX_FRIENDS;
  return (
    <button
      type="button"
      disabled={full}
      aria-pressed={on}
      title={full ? `You can follow up to ${MAX_FRIENDS} friends` : on ? 'Remove from your friends' : 'Add to your friends (saved in this browser)'}
      onClick={() => write(on ? friends.filter((f) => f !== steamId) : [...friends, steamId])}
      className={cx(
        'border px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-50',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-muted hover:border-accent hover:text-accent',
      )}
    >
      {on ? '★ Friend' : '☆ Add friend'}
    </button>
  );
}

/** Live status for the friends list, refreshed every 30 s while the tab is visible. */
function useFriendStatus(ids: string[]): { rows: FriendStatus[] | null; failed: boolean } {
  const key = ids.join(',');
  const [state, setState] = useState<{ key: string; rows: FriendStatus[] | null; failed: boolean }>({ key: '', rows: null, failed: false });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/api/friends?ids=${key}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { friends: FriendStatus[] };
        if (live) setState({ key, rows: body.friends, failed: false });
      } catch {
        if (live) setState((s) => ({ ...s, key, failed: true }));
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [key]);
  return state.key === key ? state : { rows: null, failed: false };
}

const byStatus = (a: FriendStatus, b: FriendStatus) =>
  Number(!!b.online) - Number(!!a.online) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || (a.name ?? '').localeCompare(b.name ?? '');

function FriendRow({ f, onRemove }: { f: FriendStatus; onRemove?: () => void }) {
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
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-xs text-dim hover:text-bad" aria-label={`Remove ${name} from your friends`}>
          Remove
        </button>
      )}
    </li>
  );
}

/** The /friends page body. */
export function FriendsList() {
  const friends = useFriends();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const { rows, failed } = useFriendStatus(friends);
  if (!hydrated) return <p className="px-4 py-8 text-sm text-muted">Loading your friends…</p>;
  if (!friends.length) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted">
        <p>You haven&rsquo;t added any friends yet.</p>
        <p className="mt-2">
          Find a player on the{' '}
          <Link href="/players" className="link text-accent">
            players page
          </Link>{' '}
          and press <span className="text-text">☆ Add friend</span> on their profile.
        </p>
      </div>
    );
  }
  if (!rows) return <p className="px-4 py-8 text-sm text-muted">{failed ? 'Stats are temporarily unavailable. Try again in a minute.' : 'Checking who is online…'}</p>;
  const sorted = [...rows].sort(byStatus);
  const online = sorted.filter((f) => f.online).length;
  return (
    <>
      <p className="border-b border-line px-4 py-2.5 text-sm text-muted">
        <span className="font-display text-base font-bold text-accent">{online}</span> of {friends.length} online now · refreshes every 30 seconds
      </p>
      <ul className="divide-y divide-line">
        {sorted.map((f) => (
          <FriendRow key={f.steamId} f={f} onRemove={() => write(friends.filter((x) => x !== f.steamId))} />
        ))}
      </ul>
    </>
  );
}

/** A strip on the home page of friends playing now; nothing when none are (or none are followed). */
export function FriendsOnline() {
  const friends = useFriends();
  const { rows } = useFriendStatus(friends);
  const online = (rows ?? []).filter((f) => f.online);
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
