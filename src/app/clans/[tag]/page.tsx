import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlayerLink } from '@/components/player';
import { safe } from '@/components/section';
import { Container, Empty, PageHeader, Panel, RankCell, Segmented, Stat, StatGrid, StatusDot } from '@/components/ui';
import { clanSlug, parseClanSlug } from '@/lib/clans';
import { ago, duration, int, kd, pct } from '@/lib/format';
import { clan, clans } from '@/lib/server/data';
import { clanValue, type Clan } from '@/lib/server/clans';
import { parsePeriod, PERIOD_LABELS, PERIODS } from '@/lib/server/views';
import { one, withParams } from '@/lib/url';

const nowSec = () => Math.floor(Date.now() / 1000);

export async function generateMetadata({ params }: PageProps<'/clans/[tag]'>): Promise<Metadata> {
  const tag = parseClanSlug((await params).tag);
  return { title: tag ? `[${tag}] clan` : 'Clan' };
}

/** Side-by-side rows for the compare panel: label, this clan's value, the other's, and which is better. */
const COMPARE: { label: string; value: (c: Clan) => number; show: (c: Clan) => string }[] = [
  { label: 'Players', value: (c) => c.members.length, show: (c) => int(c.members.length) },
  { label: 'Kills', value: (c) => c.kills, show: (c) => int(c.kills) },
  { label: 'K/D', value: (c) => clanValue('kd', c), show: (c) => kd(c.kills, c.deaths) },
  { label: 'Kills / hour', value: (c) => clanValue('perHour', c), show: (c) => clanValue('perHour', c).toFixed(1) },
  { label: 'Win rate', value: (c) => clanValue('winRate', c), show: (c) => pct(c.wins, c.wins + c.losses + c.draws) },
  { label: 'Headshots', value: (c) => c.headshots, show: (c) => int(c.headshots) },
  { label: 'Playtime', value: (c) => c.minutes, show: (c) => duration(c.minutes * 60) },
];

export default async function ClanPage({ params, searchParams }: PageProps<'/clans/[tag]'>) {
  const tag = parseClanSlug((await params).tag);
  if (!tag) notFound();
  const sp = await searchParams;
  const period = parsePeriod(one(sp.period), '30d');
  const vsTag = parseClanSlug(one(sp.vs) ?? '');
  const [found, all] = await Promise.all([safe(clan(tag, period)), safe(clans(period))]);
  if (found === null) notFound();
  const now = nowSec();
  const others = all instanceof Error ? [] : all.data.filter((c) => c.tag !== tag);
  const vs = vsTag ? others.find((c) => c.tag === vsTag) : undefined;
  const here = `/clans/${clanSlug(tag)}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/clans" className="link">
            Clans
          </Link>
        }
        title={`[${tag}]`}
        description={
          found instanceof Error
            ? undefined
            : `${int(found.data.clan.members.length)} players carrying the tag · ranked #${found.data.rank} of ${found.data.of} clans by kills · ${PERIOD_LABELS[period]}`
        }
      >
        <div className="mt-8">
          <Segmented
            label="Period"
            active={period}
            items={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p], href: withParams(here, sp, { period: p === '30d' ? null : p }) }))}
          />
        </div>
      </PageHeader>

      <Container className="mt-8 space-y-4">
        {found instanceof Error ? (
          <Panel>
            <p className="text-sm text-muted">Stats are temporarily unavailable. Try again in a minute.</p>
          </Panel>
        ) : (
          (() => {
            const { clan: c, avatars, online } = found.data;
            return (
              <>
                <StatGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Kills" value={int(c.kills)} accent />
                  <Stat label="K/D" value={kd(c.kills, c.deaths)} />
                  <Stat label="Kills / hour" value={clanValue('perHour', c).toFixed(1)} />
                  <Stat label="Win rate" value={pct(c.wins, c.wins + c.losses + c.draws)} />
                  <Stat label="Playtime" value={duration(c.minutes * 60)} />
                  <Stat label="Online now" value={int(online.length)} />
                </StatGrid>

                {online.length > 0 && (
                  <Panel title="Playing now" flush>
                    <ul className="divide-y divide-line text-sm">
                      {online.map((p) => (
                        <li key={p.steamId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                          <PlayerLink steamId={p.steamId} name={p.name} avatarUrl={avatars[p.steamId]} />
                          <Link href={`/servers/${p.serverSlug}`} className="link inline-flex items-center gap-2 text-muted">
                            <StatusDot online /> {p.serverName} · {int(p.kills)} kills
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}

                <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
                  <Panel title="Members" action="Most kills first" flush>
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr>
                            <th className="w-14">#</th>
                            <th>Player</th>
                            <th className="r">Kills</th>
                            <th className="r">K/D</th>
                            <th className="r hidden sm:table-cell">Playtime</th>
                            <th className="r hidden md:table-cell">Last seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.members.map((m, i) => (
                            <tr key={m.steamId}>
                              <td>
                                <RankCell rank={i + 1} />
                              </td>
                              <td className="max-w-64">
                                <PlayerLink steamId={m.steamId} name={m.name} avatarUrl={avatars[m.steamId]} />
                              </td>
                              <td className="r font-display text-base font-bold text-text">{int(m.kills)}</td>
                              <td className="r text-muted">{kd(m.kills, m.deaths)}</td>
                              <td className="r hidden text-muted sm:table-cell">{duration(m.minutes * 60)}</td>
                              <td className="r hidden text-dim md:table-cell">{m.lastSeen ? ago(Math.floor(Date.parse(m.lastSeen) / 1000), now) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>

                  <Panel title="Compare">
                    {others.length ? (
                      <>
                        <form action={here} className="flex gap-2">
                          {period !== '30d' && <input type="hidden" name="period" value={period} />}
                          <select
                            name="vs"
                            defaultValue={vs ? clanSlug(vs.tag) : ''}
                            className="min-w-0 flex-1 border border-line-strong bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-accent"
                            aria-label="Clan to compare with"
                          >
                            <option value="">Pick a clan…</option>
                            {others.map((o) => (
                              <option key={o.tag} value={clanSlug(o.tag)}>
                                [{o.tag}] · {int(o.members.length)} players
                              </option>
                            ))}
                          </select>
                          <button className="border border-line-strong px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.1em] text-muted hover:border-accent hover:text-text">
                            Compare
                          </button>
                        </form>
                        {vs && (
                          <table className="mt-4 w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted">
                                <th className="pb-2 text-left font-normal" />
                                <th className="pb-2 text-right font-display font-bold tracking-[0.06em] text-text">[{tag}]</th>
                                <th className="pb-2 text-right font-display font-bold tracking-[0.06em] text-text">
                                  <Link href={withParams(`/clans/${clanSlug(vs.tag)}`, {}, { period: period === '30d' ? null : period, vs: clanSlug(tag) })} className="link">
                                    [{vs.tag}]
                                  </Link>
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {COMPARE.map((row) => {
                                const a = row.value(c);
                                const b = row.value(vs);
                                return (
                                  <tr key={row.label}>
                                    <td className="py-1.5 text-muted">{row.label}</td>
                                    <td className={`py-1.5 text-right tabular-nums ${a > b ? 'font-semibold text-accent' : ''}`}>{row.show(c)}</td>
                                    <td className={`py-1.5 text-right tabular-nums ${b > a ? 'font-semibold text-accent' : ''}`}>{row.show(vs)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </>
                    ) : (
                      <Empty>No other clans on this board to compare with.</Empty>
                    )}
                  </Panel>
                </div>
              </>
            );
          })()
        )}
      </Container>
    </>
  );
}
