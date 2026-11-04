import type { Metadata, Viewport } from 'next';
import { TimezoneNote } from '@/components/local-time';
import { Rubik, Unbounded } from 'next/font/google';
import Link from 'next/link';
import { type Me, SiteNav } from '@/components/nav';
import { Scene } from '@/components/scene/scene';
import { InstallLink, InstallPrompt } from '@/components/install';
import { Container } from '@/components/ui';
import { accountsEnv } from '@/lib/server/accounts/env';
import { viewer } from '@/lib/server/accounts';
import { playerName } from '@/lib/server/data';
import './globals.css';

// Every page reads live data from Warcon (cached briefly in memory).
export const dynamic = 'force-dynamic';

const rubik = Rubik({ subsets: ['latin'], weight: ['400', '500', '700', '800'], variable: '--font-rubik', display: 'swap' });
const unbounded = Unbounded({ subsets: ['latin'], weight: ['800', '900'], variable: '--font-unbounded', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'TEG WARDOGS — Servers, Stats & Leaderboards', template: '%s · TEG WARDOGS' },
  description:
    'Live server status, player profiles, match history and leaderboards for The Employed Gamers WARDOGS servers.',
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
  // Installed on an iPhone's home screen: open full screen, named WARDOGS under the icon.
  appleWebApp: { capable: true, title: 'WARDOGS', statusBarStyle: 'black-translucent' },
};

/**
 * Android can say the site is installable before the page's scripts load; keep that offer for the
 * install prompt (components/install.tsx) instead of losing it.
 */
const KEEP_INSTALL_OFFER =
  "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installOffer=e})";

export const viewport: Viewport = { themeColor: '#16131c' };

/** Account linking is optional; its links only show once it's configured. */
function linkingOn(): boolean {
  try {
    return accountsEnv() !== null;
  } catch {
    return true; // misconfigured: /account explains
  }
}

/** A heads-up shown under the header on every page; null takes it down. */
const SITE_NOTICE: string | null = null;

/** The viewer for the nav: undefined when linking is off, null when signed out. */
async function navViewer(): Promise<Me> {
  if (!linkingOn()) return undefined;
  const me = await viewer();
  if (!me) return null;
  return { steamId: me.steamId, name: me.steamId ? await playerName(me.steamId).catch(() => null) : null };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await navViewer();
  return (
    <html lang="en" className={`${rubik.variable} ${unbounded.variable}`}>
      <body className="sky flex min-h-screen flex-col">
        <script dangerouslySetInnerHTML={{ __html: KEEP_INSTALL_OFFER }} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
        >
          Skip to content
        </a>
        <Scene />
        <SiteNav me={me} />
        <InstallPrompt auto />
        {SITE_NOTICE && (
          <Container className="mt-4">
            <div role="note" className="panel px-5 py-3 text-sm">
              <span className="mr-2 font-extrabold text-accent">Heads up</span>
              {SITE_NOTICE}
            </div>
          </Container>
        )}
        {/* Room at the bottom on phones so the tab bar never covers the last card. */}
        <main id="main" className="relative z-10 flex-1 pb-28 md:pb-0">
          {children}
        </main>
        <footer className="relative z-10 mt-16 pb-28 md:pb-0">
          <Container className="flex flex-col gap-4 py-8 text-sm text-muted md:flex-row md:items-center md:justify-between">
            <p className="max-w-xl text-xs leading-relaxed">
              Community statistics for The Employed Gamers WARDOGS servers, taken from the TEG Warcon panel. Not affiliated with
              Bulkhead or Team17. <TimezoneNote />
            </p>
            <div className="flex flex-wrap gap-2">
              <Link className="pill" href="/api-docs">
                Public API
              </Link>
              <InstallLink />
            </div>
          </Container>
        </footer>
      </body>
    </html>
  );
}
