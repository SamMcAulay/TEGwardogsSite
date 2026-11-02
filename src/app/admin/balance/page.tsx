import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Section, safe } from '@/components/section';
import { Badge, Container, Empty, FactionTag, PageHeader, Panel, Segmented, Stat, StatGrid } from '@/components/ui';
import { analyse, BANDS, kdOf, REFRAG_SECONDS, sideTotals, tradeRate, type Analysed, type Band, type ReasonKind, type Side } from '@/lib/balance';
import { ago, int, pct } from '@/lib/format';
import { factionColor } from '@/lib/game';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { getServers } from '@/lib/server/data';
import { preRounds } from '@/lib/server/history';
import { RATED_MIN_PEAK } from '@/lib/server/history/ratings';
import { history } from '@/lib/server/history/store';
import { SEASON_TWO_START } from '@/lib/server/seasons';
import { one } from '@/lib/url';
import { AdminNav } from '../nav';

// Staff only, like /admin: everyone else gets the ordinary 404.
export const metadata: Metadata = { title: 'Match balance', robots: { index: false, follow: false } };

const PERIODS = [
  { key: '24h', label: '24 hours', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'season', label: 'Season', days: null },
] as const;
const ROUND_LIST_MAX = 150;

const WHY: Record<ReasonKind, string> = {
  numbers: 'More players',
  skill: 'Stacked on skill',
  gunfights: 'Won the gunfights',
  teamwork: 'Traded better',
  even: 'Even stats (comms / objective)',
  upset: 'Upset',
};
const BAND_TONE: Record<Band, 'good' | 'default' | 'accent' | 'bad'> = { close: 'good', fair: 'default', 'one-sided': 'accent', landslide: 'bad' };
const bandLabel = (b: Band) => BANDS.find((x) => x.band === b)!.label;
const f2 = (n: number) => n.toFixed(2);
const share = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

type Row = { serverId: string; server: string; matchId: number; endedAt: number; map: string | null; a: Analysed };

/** Coloured segments, one per faction, sized by value. */
function Bar({ parts, label }: { parts: { faction: string; value: number }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="flex h-5 w-full overflow-hidden border border-line" role="img" aria-label={label}>
      {parts.map((p) =>
        p.value > 0 ? (
          <span
            key={p.faction}
            className="flex items-center justify-center text-[10px] font-semibold text-black/70"
            style={{ width: `${(p.value / total) * 100}%`, background: factionColor(p.faction) }}
            title={`${p.faction}: ${p.value}`}
          >
            {p.value / total >= 0.12 ? `${Math.round((p.value / total) * 100)}%` : ''}
          </span>
        ) : null,
      )}
    </div>
  );
}

function SideTable({ sides, winner }: { sides: Side[]; winner: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-muted">
          <tr>
            {['Side', 'Score', 'Players', 'Avg on', 'K / D', 'K/D', 'Kills/min', 'Deaths/min', 'HS %', 'Avg rating', 'Win chance', `Refrags (${REFRAG_SECONDS}s)`].map((h) => (
              <th key={h} className="px-3 py-2 font-normal whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sides.map((s) => (
            <tr key={s.faction} className={s.faction === winner ? 'font-semibold' : ''}>
              <td className="px-3 py-2 whitespace-nowrap"><FactionTag name={s.faction} />{s.faction === winner && ' 🏆'}</td>
              <td className="px-3 py-2">{int(s.score)}</td>
              <td className="px-3 py-2">{int(s.players)}</td>
              <td className="px-3 py-2">{s.avgOn.toFixed(1)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{int(s.kills)} / {int(s.deaths)}</td>
              <td className="px-3 py-2">{f2(kdOf(s))}</td>
              <td className="px-3 py-2">{f2(s.kpm)}</td>
              <td className="px-3 py-2">{f2(s.dpm)}</td>
              <td className="px-3 py-2">{pct(s.headshots, s.kills, 0)}</td>
              <td className="px-3 py-2">{s.rating == null ? '—' : s.rating.toFixed(1)}</td>
              <td className="px-3 py-2">{share(s.chance)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {s.teamplay ? `${int(s.teamplay.refrags)} · ${share(tradeRate(s.teamplay))} of deaths` : 'not read yet'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function load(periodKey: string, slug: string | null) {
  const h = history();
  if (!h) throw new Error('history.db is not available');
  const servers = (await getServers({ unmasked: true })).data;
  const picked = slug ? servers.filter((s) => s.slug === slug) : servers;
  const days = PERIODS.find((p) => p.key === periodKey)?.days ?? 7;
  const since = days ? Math.floor(Date.now() / 1000) - days * 86_400 : SEASON_TWO_START;
  const pre = preRounds();
  const rows: Row[] = [];
  for (const r of h.rounds(Math.max(since, SEASON_TWO_START))) {
    const server = picked.find((s) => s.id === r.serverId);
    if (!server || r.peak < RATED_MIN_PEAK) continue;
    const a = analyse(r, pre?.get(`${r.serverId}:${r.matchId}`));
    if (a) rows.push({ serverId: r.serverId, server: server.shortName, matchId: r.matchId, endedAt: r.endedAt, map: r.map, a });
  }
  return { data: { rows: rows.reverse(), servers, picked }, stale: false, missing: [] as string[] };
}

export default async function BalancePage({ searchParams }: PageProps<'/admin/balance'>) {
  const gate = await currentAdmin();
  if (!gate) notFound();
  const sp = await searchParams;
  const period = PERIODS.some((p) => p.key === one(sp.range)) ? one(sp.range)! : '7d';
  const slug = one(sp.server) ?? null;
  const band = BANDS.some((b) => b.band === one(sp.band)) ? (one(sp.band) as Band) : null;
  const href = (o: { range?: string; server?: string | null; band?: string | null }) => {
    const q = new URLSearchParams();
    const r = o.range ?? period;
    const s = o.server === undefined ? slug : o.server;
    const b = o.band === undefined ? band : o.band;
    if (r !== '7d') q.set('range', r);
    if (s) q.set('server', s);
    if (b) q.set('band', b);
    return `/admin/balance${q.size ? `?${q}` : ''}`;
  };
  const found = await safe(load(period, slug));

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Match balance"
        description="How close each round was, how the sides compared, and a best guess at why. Rounds that drew fewer than 8 players are left out."
      />
      <Container className="mt-8 space-y-4">
        <AdminNav active="balance" />
        <Section loaded={found}>
          {({ rows, servers, picked }) => {
            const totals = sideTotals(rows.map((r) => r.a));
            const big = rows.filter((r) => r.a.band === 'one-sided' || r.a.band === 'landslide');
            const withFeed = rows.filter((r) => r.a.sides.some((s) => s.teamplay)).length;
            const listed = (band ? rows.filter((r) => r.a.band === band) : rows).slice(0, ROUND_LIST_MAX);
            const perServer = servers.filter((s) => picked.includes(s)).map((s) => ({ s, t: sideTotals(rows.filter((r) => r.serverId === s.id).map((r) => r.a)) }));
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Segmented label="Period" prefetch={false} active={period} items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: href({ range: p.key }) }))} />
                  <Segmented
                    label="Server"
                    prefetch={false}
                    active={slug ?? 'all'}
                    items={[{ key: 'all', label: 'All', href: href({ server: null }) }, ...servers.map((s) => ({ key: s.slug, label: s.shortName, href: href({ server: s.slug }) }))]}
                  />
                </div>
                <p className="text-sm text-muted">
                  Closeness is each losing side&apos;s score as a share of the winner&apos;s, averaged: 100-99-99 scores 99, 0-100-0
                  scores 0. Close is 85 or more, fair 60, one-sided 35, below that a landslide. Win chance comes from everyone&apos;s
                  skill rating as it stood when the round started. A refrag is a teammate killing your killer within{' '}
                  {REFRAG_SECONDS} seconds: more of them means a side playing closer together.
                </p>
                <StatGrid className="grid-cols-2 sm:grid-cols-4">
                  <Stat label="Rounds" value={int(rows.length)} />
                  <Stat label="Average closeness" value={rows.length ? Math.round(rows.reduce((a, r) => a + r.a.closeness, 0) / rows.length) : '—'} accent />
                  <Stat label="One-sided or landslide" value={pct(big.length, rows.length, 0)} sub={`${int(big.length)} rounds`} />
                  <Stat label="Refrags read" value={pct(withFeed, rows.length, 0)} sub="of rounds; older ones fill in" />
                </StatGrid>

                {!rows.length ? (
                  <Empty>No rounds in this period.</Empty>
                ) : (
                  <>
                    <Panel title="Wins by server" action="Share of rounds won; an even split is a third each">
                      <ul className="space-y-3">
                        {perServer.map(({ s, t }) => (
                          <li key={s.id} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3 text-sm">
                            <span className="font-medium">{s.shortName}</span>
                            <Bar label={`Wins on ${s.shortName}`} parts={t.map((x) => ({ faction: x.faction, value: x.wins }))} />
                            <span className="text-xs text-muted tabular-nums">{int(t.reduce((a, x) => a + x.wins, 0))} rounds</span>
                          </li>
                        ))}
                      </ul>
                    </Panel>

                    <Panel title="Each side" flush action="Compare win rate with what ratings expected">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm tabular-nums">
                          <thead className="text-left text-xs text-muted">
                            <tr>
                              {['Side', 'Won', 'Win rate', 'Expected', 'Big wins', 'Closeness when won', 'Avg on', 'K/D', 'Kills/min', 'HS %', 'Avg rating', 'Deaths traded'].map((h) => (
                                <th key={h} className="px-4 py-2 font-normal whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {totals.map((t) => (
                              <tr key={t.faction}>
                                <td className="px-4 py-2"><FactionTag name={t.faction} /></td>
                                <td className="px-4 py-2">{int(t.wins)} / {int(t.rounds)}</td>
                                <td className="px-4 py-2 font-semibold">{pct(t.wins, t.rounds, 0)}</td>
                                <td className="px-4 py-2">{share(t.expected)}</td>
                                <td className="px-4 py-2">{int(t.bigWins)}</td>
                                <td className="px-4 py-2">{t.wins ? Math.round(t.winCloseness) : '—'}</td>
                                <td className="px-4 py-2">{t.avgOn.toFixed(1)}</td>
                                <td className="px-4 py-2">{f2(kdOf(t))}</td>
                                <td className="px-4 py-2">{f2(t.kpm)}</td>
                                <td className="px-4 py-2">{pct(t.headshots, t.kills, 0)}</td>
                                <td className="px-4 py-2">{t.rating == null ? '—' : t.rating.toFixed(1)}</td>
                                <td className="px-4 py-2">{share(tradeRate(t.teamplay))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="How close the rounds were" action="Coloured by who won">
                        <ul className="space-y-3">
                          {BANDS.map((b) => {
                            const inBand = rows.filter((r) => r.a.band === b.band);
                            return (
                              <li key={b.band} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-3 text-sm">
                                <Link prefetch={false} href={href({ band: b.band })} className="link">{b.label}</Link>
                                <div style={{ width: `${(inBand.length / rows.length) * 100}%`, minWidth: inBand.length ? '1.5rem' : 0 }}>
                                  <Bar label={`${b.label} rounds by winner`} parts={totals.map((t) => ({ faction: t.faction, value: inBand.filter((r) => r.a.winner === t.faction).length }))} />
                                </div>
                                <span className="text-right text-xs text-muted tabular-nums">{int(inBand.length)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </Panel>
                      <Panel title="Why the big wins happened" flush action="One-sided and landslide wins; a round can have several reasons">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm tabular-nums">
                            <thead className="text-left text-xs text-muted">
                              <tr>
                                <th className="px-4 py-2 font-normal">Reason</th>
                                {totals.map((t) => (
                                  <th key={t.faction} className="px-4 py-2 font-normal"><FactionTag name={t.faction} /></th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {(Object.keys(WHY) as ReasonKind[]).map((k) => (
                                <tr key={k}>
                                  <td className="px-4 py-2 whitespace-nowrap">{WHY[k]}</td>
                                  {totals.map((t) => (
                                    <td key={t.faction} className="px-4 py-2">{t.why[k] ? `${int(t.why[k])} · ${pct(t.why[k]!, t.bigWins, 0)}` : '—'}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Panel>
                    </div>

                    <Panel
                      title={band ? `${bandLabel(band)} rounds` : 'Rounds'}
                      flush
                      action={
                        band ? (
                          <Link prefetch={false} href={href({ band: null })} className="link">Show all</Link>
                        ) : (
                          `Newest first${rows.length > ROUND_LIST_MAX ? `, latest ${ROUND_LIST_MAX}` : ''} · open a row for the breakdown`
                        )
                      }
                    >
                      {listed.length ? (
                        <ul className="divide-y divide-line">
                          {listed.map((r) => (
                            <li key={`${r.serverId}:${r.matchId}`}>
                              <details>
                                <summary className="grid cursor-pointer grid-cols-[3rem_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[3rem_14rem_1fr_auto]">
                                  <span className="font-display text-xl font-bold tabular-nums">{r.a.closeness}</span>
                                  <span className="min-w-0 text-sm">
                                    <Badge tone={BAND_TONE[r.a.band]}>{bandLabel(r.a.band)}</Badge>{' '}
                                    <span className="text-xs text-muted">{r.server} · {r.map ?? '?'} · {ago(r.endedAt)}</span>
                                  </span>
                                  <span className="col-span-2 sm:col-span-1">
                                    <Bar label={`Final score ${r.a.sides.map((s) => `${s.faction} ${s.score}`).join(', ')}`} parts={r.a.sides.map((s) => ({ faction: s.faction, value: s.score }))} />
                                  </span>
                                  <span className="col-span-2 text-xs text-muted sm:col-span-1">{WHY[r.a.reasons[0]?.kind ?? 'even']}</span>
                                </summary>
                                <div className="space-y-3 border-t border-line bg-surface-2/40 py-3">
                                  <ul className="list-disc space-y-1 px-8 text-sm">
                                    {r.a.reasons.map((x) => <li key={x.kind}>{x.text}</li>)}
                                  </ul>
                                  <SideTable sides={r.a.sides} winner={r.a.winner} />
                                  <p className="px-4 text-xs">
                                    <Link prefetch={false} href={`/matches/${r.serverId}/${r.matchId}`} className="link">Open the match and its replay</Link>
                                  </p>
                                </div>
                              </details>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Empty>No {band ? bandLabel(band).toLowerCase() : ''} rounds in this period.</Empty>
                      )}
                    </Panel>
                  </>
                )}
              </div>
            );
          }}
        </Section>
      </Container>
    </>
  );
}
