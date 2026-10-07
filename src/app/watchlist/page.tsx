import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/player';
import { Container, Empty, PageHeader, Panel } from '@/components/ui';
import { ago, int } from '@/lib/format';
import { Section, safe } from '@/components/section';
import { watchlist } from '@/lib/server/data';

// Lists players by name, so it is kept out of search engines (and the sitemap).
export const metadata: Metadata = { title: 'Watchlist', robots: { index: false } };

const nowSec = () => Math.floor(Date.now() / 1000);

export default async function WatchlistPage() {
  const list = await safe(watchlist());
  const now = nowSec();

  return (
    <>
      <PageHeader
        eyebrow="Players"
        title="Watchlist"
        description="Players the staff are keeping an eye on. Being on this list is not a ban or an accusation."
      />
      <Container className="mt-8">
        <Panel
          title="Watched players"
          action={list instanceof Error ? undefined : `${int(list.data.length)} on the watchlist`}
          flush
        >
          <Section loaded={list}>
            {(rows) => !rows.length ? (
              <Empty>Nobody is on the watchlist.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((p) => (
                  <li key={p.steamId}>
                    <Link
                      prefetch={false}
                      href={`/players/${p.steamId}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                    >
                      <Avatar name={p.name} steamId={p.steamId} url={p.avatarUrl} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted">
                          Seen {ago(p.lastSeen, now)}
                          {p.serverName && ` · ${p.serverName}`}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Panel>
      </Container>
    </>
  );
}
