import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KillList } from '@/components/game';
import { Section, safe } from '@/components/section';
import { TierBadge } from '@/components/tier';
import { Container, Empty, PageHeader, Panel, Segmented, Stat, StatGrid } from '@/components/ui';
import { ago, int } from '@/lib/format';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { TEAMKILL_PAGES, teamKills } from '@/lib/server/data';
import { teamKillers } from '@/lib/server/teamkills';
import { one } from '@/lib/url';
import { AdminNav } from '../nav';

// Staff only, like /admin: everyone else gets the ordinary 404.
export const metadata: Metadata = { title: 'Team kills', robots: { index: false, follow: false } };

export default async function TeamKillsPage({ searchParams }: PageProps<'/admin/teamkills'>) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const { store } = gate.a;
  const days = one((await searchParams).range) === '7d' ? 7 : 1;
  const found = await safe(teamKills(days));

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Team kills"
        description="Who has been killing their own side, on every server. Read from the kill feeds, so a server whose feed is down shows nothing."
      />
      <Container className="mt-8 space-y-4">
        <AdminNav active="teamkills" />
        <Segmented
          label="Period"
          prefetch={false}
          active={days === 7 ? '7d' : '24h'}
          items={[
            { key: '24h', label: 'Last 24 hours', href: '/admin/teamkills' },
            { key: '7d', label: 'Last 7 days', href: '/admin/teamkills?range=7d' },
          ]}
        />
        <Section loaded={found}>
          {({ rows, capped }) => {
            const killers = teamKillers(rows);
            return (
              <div className="space-y-4">
                {capped.length > 0 && (
                  <p role="status" className="border border-line-strong bg-surface-2 px-4 py-3 text-sm text-muted">
                    {capped.join(', ')} had more than {int(TEAMKILL_PAGES * 200)} team kills in this period; only the
                    newest are counted.
                  </p>
                )}
                <StatGrid className="grid-cols-2 sm:grid-cols-3">
                  <Stat label="Team kills" value={int(killers.reduce((n, k) => n + k.count, 0))} accent />
                  <Stat label="Players" value={int(killers.length)} />
                  <Stat label="Most by one" value={int(killers[0]?.count ?? 0)} />
                </StatGrid>
                <Panel title="By player" flush action="Worst first · open a row for each kill">
                  {killers.length ? (
                    <ul className="divide-y divide-line">
                      {killers.map((k) => {
                        const link = store.bySteam(k.steamId);
                        return (
                          <li key={k.steamId}>
                            <details>
                              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                                <span className="w-10 font-display text-xl font-bold tabular-nums text-bad">
                                  {int(k.count)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium">{k.name}</span>{' '}
                                  <span className="text-xs text-muted">
                                    · {int(k.victims)} {k.victims === 1 ? 'victim' : 'victims'} · {k.servers.join(', ')}{' '}
                                    · last {ago(k.lastAt)}
                                  </span>
                                </span>
                                <span className="flex items-center gap-3 text-xs">
                                  {link && (
                                    <Link
                                      prefetch={false}
                                      href={`/admin?q=${link.discordId}`}
                                      className="link inline-flex items-center gap-2"
                                    >
                                      {link.tier ? <TierBadge tier={link.tier} compact /> : 'Linked'}
                                      {link.discordName && <span>{link.discordName}</span>}
                                    </Link>
                                  )}
                                  <Link prefetch={false} href={`/players/${k.steamId}`} className="link text-muted">
                                    Profile
                                  </Link>
                                </span>
                              </summary>
                              <div className="border-t border-line bg-surface-2/40">
                                <KillList kills={k.kills} showServer />
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <Empty>No team kills {days === 7 ? 'in the last 7 days' : 'in the last 24 hours'}.</Empty>
                  )}
                </Panel>
              </div>
            );
          }}
        </Section>
      </Container>
    </>
  );
}
