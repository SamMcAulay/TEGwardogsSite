'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { THEME_CHROME, THEME_COOKIE, type Theme } from '@/lib/theme';
import { cx } from './ui';

// The theme lives on <html data-theme>; the server sets it from the cookie, these keep it in step.
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const current = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_CHROME[theme]);
  listeners.forEach((fn) => fn());
}

function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(subscribe, current, () => initial);
}

function Sun() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
    </svg>
  );
}

function Moon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" strokeLinejoin="round" />
    </svg>
  );
}

/** The header switch: shows the theme you're on, flips to the other. */
export function ThemeToggle({ initial, className }: { initial: Theme; className?: string }) {
  const theme = useTheme(initial);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cx(
        'flex size-9 shrink-0 items-center justify-center border border-line-strong text-muted transition-colors hover:border-accent hover:text-text',
        className,
      )}
    >
      {theme === 'dark' ? <Moon /> : <Sun />}
    </button>
  );
}

/** A little drawing of the site in one theme, using that theme's real tokens. */
function Preview({ theme }: { theme: Theme }) {
  return (
    <div data-theme={theme} aria-hidden className="pointer-events-none border border-line bg-bg p-2.5 text-text">
      <div className="flex items-center gap-1.5 border-b border-line pb-2">
        <span className="h-3 w-5 bg-accent" />
        <span className="h-1.5 w-8 bg-line-strong" />
        <span className="h-1.5 w-6 bg-line" />
      </div>
      <div className="mt-2 space-y-1.5 border border-line bg-surface p-2">
        <div className="flex items-center justify-between">
          <span className="h-1.5 w-12 bg-text" />
          <span className="h-1.5 w-5 bg-accent" />
        </div>
        <div className="flex items-center justify-between">
          <span className="h-1.5 w-9 bg-muted" />
          <span className="h-1.5 w-4 bg-dim" />
        </div>
        <div className="flex items-center justify-between">
          <span className="h-1.5 w-10 bg-muted" />
          <span className="h-1.5 w-4 bg-dim" />
        </div>
      </div>
    </div>
  );
}

/**
 * Asked once, on the first visit without a saved choice. Escape or closing keeps dark, the look the
 * site always had, and saves it so the question doesn't come back.
 */
export function ThemePrompt() {
  const ref = useRef<HTMLDialogElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) ref.current?.showModal();
  }, [done]);
  if (done) return null;

  const pick = (theme: Theme) => {
    setTheme(theme);
    ref.current?.close();
    setDone(true);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="theme-prompt-title"
      onCancel={(e) => {
        e.preventDefault();
        pick('dark');
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] border border-line-strong bg-surface p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="p-5 sm:p-6">
        <p className="eyebrow text-accent!">New</p>
        <h2 id="theme-prompt-title" className="display mt-1 text-2xl">
          Light or dark?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The site now has a light mode. Pick the one you like; you can switch any time with the button at the top of
          the page.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {(['dark', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              className="group border border-line-strong p-2 text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none"
            >
              <Preview theme={t} />
              <span className="mt-2 flex items-center gap-2 px-0.5 font-display text-sm font-semibold uppercase tracking-[0.1em] text-muted transition-colors group-hover:text-text group-focus-visible:text-text">
                {t === 'dark' ? <Moon /> : <Sun />}
                {t}
              </span>
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
