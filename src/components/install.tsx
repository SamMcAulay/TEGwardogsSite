'use client';
// Installing the site as an app on a phone. Android browsers (Chrome, Edge, Samsung Internet) say
// when it can be installed (beforeinstallprompt) and show their own install dialog when asked;
// iPhones and iPads can't be asked, so they get the Share → Add to Home Screen steps. Asked once on
// a phone, like the theme; "Not now" waits 30 days. The footer link opens it any time.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ASKED = 'teg-install-asked';
const OPEN = 'teg-install-open';
const WAIT_MS = 30 * 24 * 3600 * 1000;

/** The browser's install offer, kept from when it arrives (often before React has started). */
let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  // Caught by the inline script in the layout before this file loaded.
  const early = (window as { __installOffer?: InstallEvent }).__installOffer;
  if (early) offer = early;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type Platform = 'android' | 'ios' | null;

/** How this browser installs: an Android-style offer, iOS steps, or not at all (desktop, already installed). */
function platform(): Platform {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return null;
  if (offer) return 'android';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Only Safari can add to the home screen on older iOS; others share its engine and menu today.
  return ios ? 'ios' : null;
}

function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, platform, () => null);
}

const phone = () => window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches;

function askedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(ASKED));
    return Number.isFinite(at) && at > 0 && Date.now() - at < WAIT_MS;
  } catch {
    return true; // storage blocked: don't nag on every page
  }
}

function remember() {
  try {
    localStorage.setItem(ASKED, String(Date.now()));
  } catch {}
}

/** Registers the service worker (production only: dev rebuilds would fight a cached worker). */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
}

/** The install dialog: opened once on phones that can install, or from the footer link. */
export function InstallPrompt({ auto }: { auto: boolean }) {
  useServiceWorker();
  const how = usePlatform();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);

  useEffect(() => {
    // Give the page a moment first, so it isn't the very first thing someone sees.
    if (!auto || !how || !phone() || askedRecently()) return;
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [auto, how]);

  useEffect(() => {
    if (open && how) ref.current?.showModal();
  }, [open, how]);

  if (!open || !how) return null;

  const close = () => {
    remember();
    ref.current?.close();
    setOpen(false);
  };
  const install = async () => {
    const o = offer;
    if (!o) return close();
    await o.prompt();
    await o.userChoice.catch(() => undefined);
    offer = null;
    changed();
    close();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="install-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] border border-line-strong bg-surface p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={44} height={44} />
          <div>
            <p className="eyebrow text-accent!">On your phone</p>
            <h2 id="install-title" className="display mt-1 text-2xl">
              Get the app
            </h2>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Put WARDOGS Stats on your home screen: it opens full screen like an app, with no app store and nothing to sign in to.
        </p>
        {how === 'ios' ? (
          <ol className="mt-4 space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="font-display font-bold text-accent">1</span>
              <span>
                Tap <span className="text-text">Share</span>{' '}
                <svg width="14" height="14" viewBox="0 0 16 16" aria-label="the share icon" className="inline -translate-y-px" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 1.5v9M4.5 5L8 1.5 11.5 5M3 8v6.5h10V8" />
                </svg>{' '}
                in Safari&rsquo;s toolbar
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-display font-bold text-accent">2</span>
              <span>
                Choose <span className="text-text">Add to Home Screen</span>
              </span>
            </li>
          </ol>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="border border-line-strong px-4 py-2 font-display text-xs font-semibold uppercase tracking-[0.1em] text-muted hover:border-accent hover:text-text"
          >
            {how === 'ios' ? 'Got it' : 'Not now'}
          </button>
          {how === 'android' && (
            <button
              type="button"
              onClick={install}
              className="bg-accent px-4 py-2 font-display text-xs font-semibold uppercase tracking-[0.1em] text-accent-ink hover:opacity-90"
            >
              Install
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** "Install the app" in the footer, shown only where installing is possible. */
export function InstallLink() {
  const how = usePlatform();
  if (!how) return null;
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN))} className="link text-left text-muted">
      Install the app
    </button>
  );
}
