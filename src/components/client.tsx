'use client';

import { useRouter } from 'next/navigation';
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
      className="pill !px-3 !py-1 text-xs"
    >
      {copied ? 'Copied' : label}
    </button>
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
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
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
          'w-full rounded-full border-[3px] border-edge bg-surface-2 pr-4 pl-10 text-sm shadow-[0_4px_0_var(--edge)] outline-none transition-colors placeholder:text-muted focus:border-accent',
          large ? 'h-14 text-base' : 'h-11',
        )}
      />
    </form>
  );
}
