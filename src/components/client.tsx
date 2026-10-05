'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  { href: '/players', label: 'Players' },
  { href: '/matches', label: 'Matches' },
  { href: '/feed', label: 'Kill Feed' },
];

export function NavLinks() {
  const path = usePathname();
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <>
      <nav className="hidden h-full items-stretch lg:flex" aria-label="Main">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              'relative flex items-center px-3.5 font-display text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors',
              active(n.href) ? 'text-text' : 'text-muted hover:text-text',
            )}
          >
            {n.label}
            {active(n.href) && <span className="absolute inset-x-3.5 bottom-0 h-0.5 bg-accent" />}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        className="ml-auto flex size-9 items-center justify-center border border-line-strong lg:hidden"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpenOn(open ? null : path)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          {open ? (
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
          ) : (
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" />
          )}
        </svg>
      </button>
      {open && (
        <nav className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface lg:hidden" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'block border-t border-line px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.12em]',
                active(n.href) ? 'text-accent' : 'text-text',
              )}
            >
              {n.label}
            </Link>
          ))}
          <form action="/players" className="border-t border-line p-4">
            <input
              name="q"
              placeholder="Search players or Steam ID"
              className="w-full border border-line-strong bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </form>
        </nav>
      )}
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
