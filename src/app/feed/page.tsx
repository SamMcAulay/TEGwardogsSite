import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/client';
import { KillList } from '@/components/game';
import { Container, Empty, PageHeader, Panel, Segmented, StatusDot } from '@/components/ui';
import { Section, safe } from '@/components/section';
import { getServers, recentKills } from '@/lib/server/data';
import { one, withParams } from '@/lib/url';

export const metadata: Metadata = { title: 'Kill feed' };

const LIMIT = 60;
const MIN_DISTANCES = [100, 250, 400] as const;
/** Weapon/cause ids are short identifiers; anything else is ignored rather than sent on. */
const CAUSE = /^[A-Za-z0-9._-]{1,80}$/;

export default async function FeedPage({ searchParams }: PageProps<'/feed'>) {
  const sp = await searchParams;
  const servers = await safe(getServers());
  const serverList = servers instanceof Error ? [] : servers.data;
  const serverId = serverList.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const before = serverId ? (one(sp.before) ?? null) : null;
  const kindParam = one(sp.kind);
  const kind =
    (['headshot', 'teamKill', 'suicide', 'vehicle', 'environment'] as const).find((k) => k === kindParam) ?? '';
  const minM = MIN_DISTANCES.find((m) => m === Number(one(sp.minM))) ?? null;
  const causeParam = one(sp.cause);
  const cause = causeParam && CAUSE.test(causeParam) ? causeParam : undefined;
  const kills = await safe(recentKills({ serverId, before, limit: LIMIT, kind, minM, cause }));
  const oldest = !(kills instanceof Error) && serverId ? kills.data[kills.data.length - 1]?.cursor : undefined;

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
              ...serverList.map((s) => ({
                key: s.id,
                label: s.shortName,
                href: withParams('/feed', sp, { server: s.id, before: null }),
              })),
            ]}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Segmented
            label="Kind"
            active={kind || 'all'}
            items={[
              { key: 'all', label: 'All', href: withParams('/feed', sp, { kind: null, before: null }) },
              {
                key: 'headshot',
                label: 'Headshots',
                href: withParams('/feed', sp, { kind: 'headshot', before: null }),
              },
              {
                key: 'teamKill',
                label: 'Team kills',
                href: withParams('/feed', sp, { kind: 'teamKill', before: null }),
              },
              { key: 'vehicle', label: 'Vehicles', href: withParams('/feed', sp, { kind: 'vehicle', before: null }) },
            ]}
          />
          <Segmented
            label="Min distance"
            active={String(minM ?? 'any')}
            items={[
              { key: 'any', label: 'Any', href: withParams('/feed', sp, { minM: null, before: null }) },
              ...MIN_DISTANCES.map((m) => ({
                key: String(m),
                label: `${m} m`,
                href: withParams('/feed', sp, { minM: m, before: null }),
              })),
            ]}
          />
        </div>
      </PageHeader>
      <Container className="mt-8">
        <Panel
          title={serverId ? serverList.find((s) => s.id === serverId)?.name : 'All servers'}
          action={
            before ? (
              <Link href={withParams('/feed', sp, { before: null })} className="link">
                Back to live →
              </Link>
            ) : undefined
          }
          flush
        >
          <Section loaded={kills}>
            {(rows) => (
              <>
                {rows.length ? <KillList kills={rows} showServer={!serverId} /> : <Empty>No kills recorded.</Empty>}
                {rows.length === LIMIT && oldest && (
                  <div className="border-t border-line px-4 py-3 text-right">
                    <Link
                      href={withParams('/feed', sp, { before: oldest })}
                      className="border border-line-strong px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.1em] transition-colors hover:border-accent hover:text-accent"
                    >
                      Older →
                    </Link>
                  </div>
                )}
              </>
            )}
          </Section>
        </Panel>
      </Container>
    </>
  );
}
