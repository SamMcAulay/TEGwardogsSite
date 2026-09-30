import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import { NavLinks, SearchBox } from '@/components/client';
import { Container, StatusDot } from '@/components/ui';
import { int } from '@/lib/format';
import { getServers } from '@/lib/server/queries';
import './globals.css';

// Every page reads live data from the local database.
export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
});
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'TEG WARDOGS — Servers, Stats & Leaderboards', template: '%s · TEG WARDOGS' },
  description:
    'Live server status, player profiles, match history, leaderboards and weapon statistics for The Employed Gamers WARDOGS servers.',
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
};

export const viewport: Viewport = { themeColor: '#07090c' };

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="TEG WARDOGS home">
      <span className="flex h-8 items-center bg-accent px-2 font-display text-lg leading-none font-bold tracking-[0.04em] text-accent-ink">
        TEG
      </span>
      <span className="hidden flex-col leading-none sm:flex">
        <span className="display text-[17px] tracking-[0.14em]">Wardogs</span>
        <span className="mt-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-dim">
          Stats &amp; Servers
        </span>
      </span>
    </Link>
  );
}

function OnlinePill() {
  const servers = getServers();
  const online = servers.reduce((a, s) => a + s.players.length, 0);
  const up = servers.filter((s) => s.online).length;
  return (
    <Link
      href="/servers"
      className="hidden items-center gap-2 border border-line-strong px-3 py-1.5 text-xs transition-colors hover:border-accent md:flex"
      title={`${up}/${servers.length} servers online`}
    >
      <StatusDot online={up > 0} />
      <span className="num font-semibold text-text">{int(online)}</span>
      <span className="text-muted">online</span>
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <Container className="relative flex h-14 items-center gap-6">
            <Logo />
            <NavLinks />
            <div className="ml-auto hidden items-center gap-3 lg:flex">
              <div className="w-60 xl:w-72">
                <SearchBox />
              </div>
              <OnlinePill />
            </div>
          </Container>
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="mt-20 border-t border-line">
          <Container className="flex flex-col gap-6 py-10 text-sm text-muted md:flex-row md:items-start md:justify-between">
            <div className="max-w-md">
              <Logo />
              <p className="mt-4 text-xs leading-relaxed text-dim">
                Community statistics for The Employed Gamers WARDOGS servers, collected from the official server RCON
                API and kill feed. Not affiliated with Bulkhead or Team17. All times UTC.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px]">
              <Link className="link text-muted" href="/servers">
                Servers
              </Link>
              <Link className="link text-muted" href="/matches">
                Match history
              </Link>
              <Link className="link text-muted" href="/leaderboards">
                Leaderboards
              </Link>
              <Link className="link text-muted" href="/weapons">
                Weapons
              </Link>
              <Link className="link text-muted" href="/players">
                Players
              </Link>
              <Link className="link text-muted" href="/compare">
                Compare players
              </Link>
              <Link className="link text-muted" href="/feed">
                Kill feed
              </Link>
              <Link className="link text-muted" href="/api-docs">
                Public API
              </Link>
            </div>
          </Container>
        </footer>
      </body>
    </html>
  );
}
