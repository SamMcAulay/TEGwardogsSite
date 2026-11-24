import type { Metadata, Viewport } from 'next';
import { TimezoneNote } from '@/components/local-time';
import localFont from 'next/font/local';
import Link from 'next/link';
import { type Me, SiteNav } from '@/components/nav';
import { PageSwipe } from '@/components/page-swipe';
import { InstallLink, InstallPrompt } from '@/components/install';
import { Container } from '@/components/ui';
import { accountsEnv } from '@/lib/server/accounts/env';
import { viewer } from '@/lib/server/accounts';
import { getServers, playerName } from '@/lib/server/data';
import './globals.css';

// Every page reads live data from Warcon (cached briefly in memory).
export const dynamic = 'force-dynamic';

// Bundled (Fontsource variable, latin, OFL) rather than next/font/google: fetching from Google during
// the build kept failing CI with "Can't resolve '@vercel/turbopack-next/internal/font/google/font'".
// Archivo with its width axis: condensed for the broadcast graphics, normal width for reading.
const archivo = localFont({
  src: './fonts/archivo-latin-wdth-wght.woff2',
  weight: '100 900',
  variable: '--font-archivo',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
});

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

export const viewport: Viewport = { themeColor: '#0b0d12' };

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

/** "2 servers live · 184 playing" for the header; null when Warcon can't say. */
async function onAir(): Promise<{ live: number; playing: number } | null> {
  try {
    const { data } = await getServers();
    return { live: data.filter((s) => s.online).length, playing: data.reduce((a, s) => a + s.playerCount, 0) };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [me, air] = await Promise.all([navViewer(), onAir()]);
  return (
    <html lang="en" className={archivo.variable}>
      <body className="flex min-h-screen flex-col">
        <script dangerouslySetInnerHTML={{ __html: KEEP_INSTALL_OFFER }} />
        <a
          href="#main"
          className="pill pill-on sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to content
        </a>
        <SiteNav me={me} air={air} />
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
        <main id="main" className="relative z-10 flex-1 pb-20 md:pb-0">
          <PageSwipe>{children}</PageSwipe>
        </main>
        <footer className="relative z-10 mt-16 pb-20 md:pb-0">
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
