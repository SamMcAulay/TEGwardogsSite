'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/account/actions';
import { activeTab, TABS, youItems } from '@/lib/nav';
import { FriendToast, newsCount, useFriendNews } from './friend-news';
import { cx } from './ui';

/** Who's looking: null signed out; undefined when account linking is off (no You at all). */
export type Me = { steamId: string | null; name: string | null } | null | undefined;

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="num inline-flex min-w-5 items-center justify-center rounded-full border-2 border-edge bg-accent px-1 text-[11px] leading-4 font-extrabold text-on-fill">
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

/** The header (logo, Live · Stats · Players, search, You) and, on phones, the bottom bar. */
export function SiteNav({ me }: { me: Me }) {
  const path = usePathname();
  const tab = activeTab(path);
  const news = useFriendNews(!!me?.steamId);
  const count = newsCount(news);
  return (
    <>
      <header style={{ viewTransitionName: 'site-header' }} className="sticky top-0 z-30 px-4 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 sm:gap-4">
          <Link href="/" className="display shrink-0 text-xl" aria-label="TEG WARDOGS home">
            TEG <span className="text-accent">WARDOGS</span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex" aria-label="Main">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                aria-current={tab === t.key ? 'page' : undefined}
                className={cx('pill', tab === t.key && 'pill-on')}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/players" className="pill !px-3 sm:!px-4" aria-label="Search players">
              <SearchIcon />
              <span className="hidden text-muted lg:inline">Find a player</span>
            </Link>
            {me !== undefined && <YouMenu me={me} count={count} on={tab === 'you'} />}
          </div>
        </div>
      </header>
      <BottomBar me={me} count={count} />
      <FriendToast news={news} />
    </>
  );
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
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpenOn(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={box} className="relative hidden md:block">
      <button
        type="button"
        aria-expanded={open}
        aria-label={count ? `You, ${count} friend update${count === 1 ? '' : 's'}` : 'You'}
        onClick={() => setOpen(!open)}
        className={cx('pill', on && 'pill-on')}
      >
        <span className="size-6 rounded-full border-2 border-edge bg-manticore" aria-hidden />
        <span className="max-w-32 truncate">{me?.name ?? (me ? 'You' : 'Sign in')}</span>
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
    <div className="mb-2 border-b-2 border-dashed border-line px-3 pb-3">
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
              className="flex items-center justify-between rounded-2xl px-3 py-2 font-bold hover:bg-surface-2"
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
                className="w-full rounded-2xl px-3 py-2 text-left font-bold text-muted hover:bg-surface-2 hover:text-text"
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
  const item = (on: boolean) =>
    cx(
      'flex flex-col items-center gap-1 rounded-2xl py-1.5 text-xs font-bold',
      on ? 'bg-accent text-on-fill' : 'text-muted',
    );
  return (
    <>
      {you && me !== undefined && (
        <YouPanel me={me} count={count} className="fixed right-3 bottom-24 left-3 md:hidden" />
      )}
      <nav
        aria-label="Main"
        style={{ viewTransitionName: 'site-tabbar' }}
        className="fixed right-3 bottom-3 left-3 z-40 grid grid-flow-col auto-cols-fr gap-1 rounded-[24px] border-[3px] border-edge bg-surface-2 p-1.5 shadow-[0_6px_0_var(--edge)] md:hidden"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? 'page' : undefined}
            className={item(tab === t.key)}
          >
            <span className="size-5 rounded-md border-2 border-current" aria-hidden />
            {t.label}
          </Link>
        ))}
        {me !== undefined && (
          <button type="button" aria-expanded={you} onClick={() => setYou(!you)} className={item(tab === 'you' || you)}>
            <span className="relative size-5 rounded-full border-2 border-current" aria-hidden>
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 size-2.5 rounded-full border-2 border-edge bg-accent" />
              )}
            </span>
            You
          </button>
        )}
      </nav>
    </>
  );
}
