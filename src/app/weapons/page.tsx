import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, Empty, Meter, PageHeader, Panel, Segmented, cx } from '@/components/ui';
import { compact, int, metres, pct } from '@/lib/format';
import { causeInfo, type CauseKind } from '@/lib/game';
import { parsePeriod, PERIOD_LABELS, PERIODS, weaponStats } from '@/lib/server/queries';
import { one, withParams } from '@/lib/url';

export const metadata: Metadata = { title: 'Weapons' };

const GROUPS: { key: string; label: string; kinds: CauseKind[] }[] = [
  { key: 'all', label: 'All', kinds: [] },
  { key: 'firearms', label: 'Firearms', kinds: ['weapon'] },
  { key: 'explosives', label: 'Explosives', kinds: ['explosive'] },
  { key: 'vehicles', label: 'Vehicles', kinds: ['vehicle', 'vehicle weapon'] },
  { key: 'other', label: 'Other', kinds: ['buildable', 'other'] },
];

export default async function WeaponsPage({ searchParams }: PageProps<'/weapons'>) {
  const sp = await searchParams;
  const period = parsePeriod(one(sp.period), '30d');
  const group = GROUPS.find((g) => g.key === one(sp.type)) ?? GROUPS[0];
  const all = weaponStats(period);
  const total = all.reduce((a, w) => a + w.kills, 0);
  const rows = all.filter((w) => !group.kinds.length || group.kinds.includes(causeInfo(w.cause).kind));
  const max = rows[0]?.kills ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Arsenal"
        title="Weapons"
        description="What is actually killing people on TEG servers, from the server kill feed. Teamkills and suicides excluded."
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Segmented
            label="Period"
            active={period}
            items={PERIODS.map((p) => ({
              key: p,
              label: PERIOD_LABELS[p],
              href: withParams('/weapons', sp, { period: p }),
            }))}
          />
          <Segmented
            label="Type"
            active={group.key}
            items={GROUPS.map((g) => ({
              key: g.key,
              label: g.label,
              href: withParams('/weapons', sp, { type: g.key === 'all' ? null : g.key }),
            }))}
          />
        </div>
      </PageHeader>
      <Container className="mt-8">
        <Panel title={`${group.label} · ${PERIOD_LABELS[period]}`} action={`${compact(total)} kills total`} flush>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Weapon</th>
                    <th className="w-56">Kills</th>
                    <th className="r">Share</th>
                    <th className="r">HS %</th>
                    <th className="r hidden sm:table-cell">Avg distance</th>
                    <th className="r">Longest</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w, i) => {
                    const info = causeInfo(w.cause);
                    return (
                      <tr key={w.cause}>
                        <td className="num text-dim">{i + 1}</td>
                        <td>
                          <Link href={`/weapons/${encodeURIComponent(w.cause)}`} className="link font-medium">
                            {info.label}
                          </Link>
                          <span className="ml-2 text-xs text-dim capitalize">{info.kind}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="num w-16 text-right font-semibold">{int(w.kills)}</span>
                            <Meter value={w.kills} max={max} />
                          </div>
                        </td>
                        <td className="r text-muted">{pct(w.kills, total)}</td>
                        <td className={cx('r', w.headshots ? 'text-muted' : 'text-dim')}>
                          {pct(w.headshots, w.kills)}
                        </td>
                        <td className="r hidden text-muted sm:table-cell">
                          {w.avgDistance ? metres(w.avgDistance) : '—'}
                        </td>
                        <td className="r text-muted">{w.longest ? metres(w.longest) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No kills recorded for this filter.</Empty>
          )}
        </Panel>
      </Container>
    </>
  );
}
