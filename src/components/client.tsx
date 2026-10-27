'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FriendToast, newsCount, useFriendNews } from './friend-news';
import { cx } from './ui';

/** Re-renders the current page's server components on an interval while the tab is visible. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="border border-line-strong px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-accent hover:text-accent"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

const NAV = [
  { href: '/servers', label: 'Servers' },
  { href: '/leaderboards', label: 'Leaderboards' },
  { href: '/clans', label: 'Clans' },
  { href: '/records', label: 'Records' },
  { href: '/players', label: 'Players' },
  { href: '/matches', label: 'Matches' },
  { href: '/feed', label: 'Kill Feed' },
  { href: '/friends', label: 'Friends' },
];

/** A count of friend news beside the Friends tab. */
function NewsBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="num ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-4 font-bold tracking-normal text-accent-ink">
      {n > 9 ? '9+' : n}
      <span className="sr-only"> new</span>
    </span>
  );
}

/**
 * The header's links. `account`: My profile once linked, else Account; null when linking is off.
 * `friends`: the viewer is a linked member, so the Friends tab lights up with their friend news.
 */
export function NavLinks({ account, friends = false }: { account?: { href: string; label: string } | null; friends?: boolean }) {
  const path = usePathname();
  const news = useFriendNews(friends);
  const count = newsCount(news);
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <>
      <nav className="hidden h-full items-stretch xl:flex" aria-label="Main">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              'relative flex items-center px-3 font-display text-[13px] font-semibold whitespace-nowrap uppercase tracking-[0.12em] transition-colors',
              active(n.href) || (n.href === '/friends' && count) ? 'text-text' : 'text-muted hover:text-text',
              n.href === '/friends' && count > 0 && 'text-accent',
            )}
          >
            {n.label}
            {n.href === '/friends' && <NewsBadge n={count} />}
            {active(n.href) && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        className="relative ml-auto flex size-9 items-center justify-center border border-line-strong xl:hidden"
        aria-label={count ? `Menu, ${count} friend update${count === 1 ? '' : 's'}` : 'Menu'}
        aria-expanded={open}
        onClick={() => setOpenOn(open ? null : path)}
      >
        {count > 0 && !open && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-bg bg-accent" aria-hidden />}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          {open ? (
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
          ) : (
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" />
          )}
        </svg>
      </button>
      {open && (
        <nav className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface xl:hidden" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'block border-t border-line px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.12em]',
                active(n.href) || (n.href === '/friends' && count) ? 'text-accent' : 'text-text',
              )}
            >
              {n.label}
              {n.href === '/friends' && <NewsBadge n={count} />}
            </Link>
          ))}
          {account && (
            <Link
              href={account.href}
              prefetch={false}
              className={cx(
                'block border-t border-line px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.12em]',
                active(account.href) ? 'text-accent' : 'text-text',
              )}
            >
              {account.label}
            </Link>
          )}
          <form action="/players" className="border-t border-line p-4">
            <input
              name="q"
              placeholder="Search players or Steam ID"
              className="w-full border border-line-strong bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </form>
        </nav>
      )}
      <FriendToast news={news} />
    </>
  );
}

export function SearchBox({
  defaultValue = '',
  autoFocus,
  large,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  large?: boolean;
}) {
  return (
    <form action="/players" role="search" className="relative">
      <svg
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden
      >
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <input
        name="q"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        placeholder="Search players or Steam ID"
        aria-label="Search players"
        className={cx(
          'w-full border border-line-strong bg-bg pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-dim focus:border-accent',
          large ? 'h-12 text-base' : 'h-9',
        )}
      />
    </form>
  );
}
