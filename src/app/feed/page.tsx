import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/client';
import { KillList } from '@/components/game';
import { Container, Empty, PageHeader, Panel, Segmented, StatusDot } from '@/components/ui';
import { getServers, recentKills } from '@/lib/server/queries';
import { one, withParams } from '@/lib/url';

export const metadata: Metadata = { title: 'Kill feed' };

const LIMIT = 60;

export default async function FeedPage({ searchParams }: PageProps<'/feed'>) {
  const sp = await searchParams;
  const servers = getServers();
  const serverId = servers.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const before = Number(one(sp.before)) || null;
  const kills = recentKills({ serverId, before, limit: LIMIT });
  const oldest = kills[kills.length - 1]?.seq;

  return (
    <>
      {!before && <AutoRefresh seconds={5} />}
      <PageHeader
        eyebrow={
          <>
            <StatusDot online={!before} /> {before ? 'Archive' : 'Live · refreshes every 5s'}
          </>
        }
        title="Kill feed"
        description="Every kill as the servers report it. HS marks a headshot; TK a teamkill."
      >
        <div className="mt-8 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented
            label="Server"
            active={serverId ?? 'all'}
            items={[
              { key: 'all', label: 'All servers', href: withParams('/feed', sp, { server: null, before: null }) },
              ...servers.map((s) => ({
                key: s.id,
                label: s.shortName,
                href: withParams('/feed', sp, { server: s.id, before: null }),
              })),
            ]}
          />
        </div>
      </PageHeader>
      <Container className="mt-8">
        <Panel
          title={serverId ? servers.find((s) => s.id === serverId)?.name : 'All servers'}
          action={
            before ? (
              <Link href={withParams('/feed', sp, { before: null })} className="link">
                Back to live →
              </Link>
            ) : undefined
          }
          flush
        >
          {kills.length ? <KillList kills={kills} showServer={!serverId} /> : <Empty>No kills recorded.</Empty>}
          {kills.length === LIMIT && oldest && (
            <div className="border-t border-line px-4 py-3 text-right">
              <Link
                href={withParams('/feed', sp, { before: oldest })}
                className="border border-line-strong px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.1em] transition-colors hover:border-accent hover:text-accent"
              >
                Older →
              </Link>
            </div>
          )}
        </Panel>
      </Container>
    </>
  );
}
