'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/account/actions';
import { activeTab, dismisses, TABS, youItems } from '@/lib/nav';
import { FriendToast, newsCount, useFriendNews } from './friend-news';
import { cx } from './ui';

/** Who's looking: null signed out; undefined when account linking is off (no You at all). */
export type Me = { steamId: string | null; name: string | null } | null | undefined;

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="num inline-flex min-w-5 items-center justify-center bg-onair px-1 text-[11px] leading-4 font-extrabold text-white">
      {n > 9 ? '9+' : n}
      <span className="sr-only"> new</span>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" />
    </svg>
  );
}

/** The header (logo plate, Live · Stats · Players · You, search, who's on) and, on phones, the bottom bar. */
export function SiteNav({ me, air }: { me: Me; air: { live: number; playing: number } | null }) {
  const path = usePathname();
  const tab = activeTab(path);
  const news = useFriendNews(!!me?.steamId);
  const count = newsCount(news);
  return (
    <>
      <header style={{ viewTransitionName: 'site-header' }} className="bc-top">
        <div className="bc-bar mx-auto max-w-[1480px] px-4 md:px-[clamp(16px,2.4vw,32px)]">
          <Link href="/" className="bc-logo" aria-label="TEG WARDOGS home">
            <b>TEG</b>
            <span>WARDOGS</span>
          </Link>
          <nav className="bc-nav" aria-label="Main">
            {TABS.map((t) => (
              <Link key={t.key} href={t.href} aria-current={tab === t.key ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
            {me !== undefined && <YouMenu me={me} count={count} on={tab === 'you'} />}
          </nav>
          <Link href="/players" className="bc-search bc-plate" aria-label="Find a player">
            <SearchIcon />
            <span>Find a player</span>
          </Link>
          {air && (
            <span className="bc-air">
              <i aria-hidden />
              {air.live} SERVER{air.live === 1 ? '' : 'S'} LIVE · {air.playing} PLAYING
            </span>
          )}
        </div>
      </header>
      <BottomBar me={me} count={count} />
      <FriendToast news={news} />
    </>
  );
}

/** While `open`, closes on Escape or a press outside every element in `inside`. */
function useDismiss(open: boolean, close: () => void, ...inside: React.RefObject<HTMLElement | null>[]) {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const on = (e: Event) => {
      const hit = inside.some((r) => r.current?.contains(e.target as Node));
      if (dismisses({ type: e.type, key: e instanceof KeyboardEvent ? e.key : undefined }, hit)) latest.current();
    };
    document.addEventListener('mousedown', on);
    document.addEventListener('touchstart', on);
    document.addEventListener('keydown', on);
    return () => {
      document.removeEventListener('mousedown', on);
      document.removeEventListener('touchstart', on);
      document.removeEventListener('keydown', on);
    };
    // the refs are stable; `inside` is a fresh array each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function YouMenu({
  me,
  count,
  on,
}: {
  me: { steamId: string | null; name: string | null } | null;
  count: number;
  on: boolean;
}) {
  // The menu belongs to the page it was opened on, so navigating closes it.
  const path = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (v: boolean) => setOpenOn(v ? path : null);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpenOn(null), box);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={count ? `You, ${count} friend update${count === 1 ? '' : 's'}` : 'You'}
        onClick={() => setOpen(!open)}
        data-on={on || undefined}
        className="flex items-center gap-2"
      >
        <span className="max-w-32 truncate">{me ? 'You' : 'Sign in'}</span>
        <Badge n={count} />
      </button>
      {open && <YouPanel me={me} count={count} className="absolute top-full right-0 mt-3 w-64" />}
    </div>
  );
}

type OnlineFriend = { steamId: string; name: string; serverName: string; serverSlug: string };

/** Friends on a server right now, fetched when the menu opens. */
function FriendsOnline() {
  const [online, setOnline] = useState<OnlineFriend[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/me/friends?online=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { online?: OnlineFriend[] } | null) => live && setOnline(d?.online ?? []))
      .catch(() => live && setOnline([]));
    return () => {
      live = false;
    };
  }, []);
  if (!online?.length) return null;
  return (
    <div className="mb-2 border-b border-line px-3 pb-3">
      <div className="eyebrow mb-1.5">Friends playing now</div>
      <ul className="grid gap-1 text-sm">
        {online.slice(0, 5).map((f) => (
          <li key={f.steamId} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-good" aria-hidden />
            <Link prefetch={false} href={`/players/${f.steamId}`} className="link min-w-0 truncate font-bold">
              {f.name}
            </Link>
            <span className="ml-auto shrink-0 text-muted">{f.serverName}</span>
          </li>
        ))}
      </ul>
      {online.length > 5 && (
        <Link href="/friends" className="mt-1.5 block text-sm font-bold text-accent">
          All friends →
        </Link>
      )}
    </div>
  );
}

function YouPanel({
  me,
  count,
  className,
}: {
  me: { steamId: string | null } | null;
  count: number;
  className?: string;
}) {
  return (
    <div className={cx('panel z-50 p-3', className)}>
      {me?.steamId && <FriendsOnline />}
      <ul className="grid gap-1">
        {youItems(me).map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              prefetch={i.href.startsWith('/players/') ? false : undefined}
              className="flex items-center justify-between px-3 py-2 font-bold hover:bg-surface-2"
            >
              {i.label}
              {i.href === '/friends' && <Badge n={count} />}
            </Link>
          </li>
        ))}
        {me && (
          <li>
            <form action={signOut}>
              <button
                type="submit"
                className="w-full px-3 py-2 text-left font-bold text-muted hover:bg-surface-2 hover:text-text"
              >
                Sign out
              </button>
            </form>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Phones: the four homes in a bar fixed to the bottom of the screen, never hidden. */
function BottomBar({ me, count }: { me: Me; count: number }) {
  const path = usePathname();
  const tab = activeTab(path);
  const [youOn, setYouOn] = useState<string | null>(null);
  const you = youOn === path;
  const setYou = (v: boolean) => setYouOn(v ? path : null);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useDismiss(you, () => setYouOn(null), panel, toggle);
  const item = (on: boolean) =>
    cx(
      'flex flex-col items-center justify-center gap-1 py-2 text-xs font-extrabold uppercase tracking-wider [font-stretch:80%]',
      on ? 'bg-white text-on-fill' : 'text-muted',
    );
  return (
    <>
      {you && me !== undefined && (
        <div ref={panel}>
          <YouPanel me={me} count={count} className="fixed right-3 bottom-16 left-3 md:hidden" />
        </div>
      )}
      <nav
        aria-label="Main"
        style={{ viewTransitionName: 'site-tabbar' }}
        className="fixed right-0 bottom-0 left-0 z-40 grid grid-flow-col auto-cols-fr gap-0.5 border-t-2 border-onair bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? 'page' : undefined}
            className={item(tab === t.key)}
          >
            {t.label}
          </Link>
        ))}
        {me !== undefined && (
          <button ref={toggle} type="button" aria-expanded={you} onClick={() => setYou(!you)} className={item(tab === 'you' || you)}>
            <span className="flex items-center gap-1">
              You
              {count > 0 && <span className="size-2 bg-onair" aria-label={`${count} new`} />}
            </span>
          </button>
        )}
      </nav>
    </>
  );
}
