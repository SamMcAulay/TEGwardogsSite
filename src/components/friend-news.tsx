'use client';
// Friend news for a signed-in, linked member: requests waiting on them and theirs that were
// accepted, as a count on the Friends tab and a pop-up that can be dismissed for the visit.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { markFriendsSeen } from '@/app/friends/actions';

export interface FriendNews {
  incoming: number;
  accepted: { steamId: string; name: string | null }[];
}

/** Fired by /friends when what it shows changes, so the header catches up without a reload. */
export const FRIEND_NEWS_EVENT = 'friend-news';
const DISMISSED_KEY = 'friend-news-dismissed';
/** Checked again this often while the tab is visible. */
const POLL_MS = 120_000;

export const newsCount = (n: FriendNews | null) => (n ? n.incoming + n.accepted.length : 0);

/** Same news, same key: a dismissed pop-up stays away until something new arrives. */
const newsKey = (n: FriendNews) => `${n.incoming}|${n.accepted.map((a) => a.steamId).join(',')}`;

/** The member's news, or null when it can't be read (offline, mid-deploy): keep what's shown. */
async function fetchNews(): Promise<FriendNews | null> {
  try {
    const r = await fetch('/api/me/friends', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as FriendNews) : null;
  } catch {
    return null;
  }
}

export function useFriendNews(enabled: boolean): FriendNews | null {
  const path = usePathname();
  const [news, setNews] = useState<FriendNews | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => fetchNews().then((n) => live && n && setNews(n));
    load();
    const id = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    window.addEventListener(FRIEND_NEWS_EVENT, load);
    return () => {
      live = false;
      clearInterval(id);
      window.removeEventListener(FRIEND_NEWS_EVENT, load);
    };
  }, [enabled, path]);
  return enabled ? news : null;
}

/**
 * Rendered by /friends: once it's on screen, marks accepted requests seen, then tells the header to
 * look again; and again whenever the page's lists change.
 */
export function FriendNewsPing({ stamp }: { stamp: string }) {
  useEffect(() => {
    markFriendsSeen()
      .catch(() => {})
      .then(() => window.dispatchEvent(new Event(FRIEND_NEWS_EVENT)));
  }, [stamp]);
  return null;
}

function names(accepted: FriendNews['accepted']): string {
  const first = accepted[0]?.name ?? 'A player';
  return accepted.length === 1 ? first : `${first} and ${accepted.length - 1} other${accepted.length > 2 ? 's' : ''}`;
}

/** The pop-up, below the header on the right; never on /friends itself. */
export function FriendToast({ news }: { news: FriendNews | null }) {
  const path = usePathname();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return typeof window === 'undefined' ? null : sessionStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  if (!news || !newsCount(news) || path === '/friends' || dismissed === newsKey(news)) return null;
  const dismiss = () => {
    const key = newsKey(news);
    setDismissed(key);
    try {
      sessionStorage.setItem(DISMISSED_KEY, key);
    } catch {
      // private mode: it just stays dismissed until the next page load
    }
  };
  return (
    <div
      role="status"
      className="fixed top-16 right-4 left-4 z-40 border border-accent/50 bg-surface-2 shadow-xl sm:left-auto sm:w-80"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          {news.accepted.length > 0 && (
            <p>
              <span className="font-semibold">{names(news.accepted)}</span> accepted your friend request.
            </p>
          )}
          {news.incoming > 0 && (
            <p>
              {news.incoming === 1 ? 'A friend request is' : `${news.incoming} friend requests are`} waiting for you.
            </p>
          )}
          <Link href="/friends" onClick={dismiss} className="link inline-block pt-1 font-display text-xs font-semibold uppercase tracking-[0.1em] text-accent">
            Open friends →
          </Link>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="-mr-1 p-1 text-dim transition-colors hover:text-text">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
