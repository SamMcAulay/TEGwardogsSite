import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Section, safe } from '@/components/section';
import { Badge, Container, cx, Empty, FactionTag, PageHeader, Panel, Segmented, Stat, StatGrid } from '@/components/ui';
import type { ReactNode } from 'react';
import { analyse, BAND_TONE, bandLabel, BANDS, calibration, clanSides, kdOf, loyalty, REFRAG_SECONDS, sideTotals, splitBy, tradeRate, type Analysed, type Band, type ReasonKind, type Side, type Split } from '@/lib/balance';
import { clanTag } from '@/lib/clans';
import { ago, int, pct } from '@/lib/format';
import { factionColor } from '@/lib/game';
import { currentAdmin } from '@/lib/server/accounts/admin';
import { getServers, seasonNames } from '@/lib/server/data';
import { preRounds, ratings } from '@/lib/server/history';
import { RATED_MIN_PEAK } from '@/lib/server/history/ratings';
import { history, type StoredLine } from '@/lib/server/history/store';
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
const f2 = (n: number) => n.toFixed(2);
const share = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

type Row = { serverId: string; server: string; matchId: number; endedAt: number; map: string | null; a: Analysed; lines: StoredLine[] };
/** Players need this many rounds in the period, and clans this many members, to be judged on side loyalty. */
const LOYAL_MIN_ROUNDS = 10;
const LOYAL_SHARE = 0.6;
const LOYAL_LIST_MAX = 40;
const HOUR_BLOCK = 3;
const p100 = (n: number) => Math.round(n * 100);
const bucketLabel = (g: { from: number; to: number }) => (!g.from ? `under ${p100(g.to)}%` : g.to > 1 ? `${p100(g.from)}%+` : `${p100(g.from)}–${p100(g.to)}%`);
const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Coloured segments, one per faction, sized by value. `plain`: no % labels (for bars too short to hold them). */
function Bar({ parts, label, plain }: { parts: { faction: string; value: number }[]; label: string; plain?: boolean }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className={cx('flex w-full overflow-hidden', plain ? 'h-full' : 'h-5 border border-line')} role="img" aria-label={label}>
      {parts.map((p) =>
        p.value > 0 ? (
          <span
            key={p.faction}
            className="flex items-center justify-center text-[10px] font-semibold text-black/70"
            style={{ width: `${(p.value / total) * 100}%`, background: factionColor(p.faction) }}
            title={`${p.faction}: ${p.value}`}
          >
            {!plain && p.value / total >= 0.12 ?`${Math.round((p.value / total) * 100)}%` : ''}
          </span>
        ) : null,
      )}
    </div>
  );
}

/** How to read the panel it sits in. */
function Help({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return <p className={cx('max-w-3xl text-sm text-muted', flush ? 'border-b border-line px-4 py-3' : 'mb-4')}>{children}</p>;
}

/** Each faction's count with its colour, written out. */
function Legend({ parts, of }: { parts: { faction: string; value: number }[]; of: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
      {parts.filter((w) => w.value).map((w) => (
        <span key={w.faction} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2" style={{ background: factionColor(w.faction) }} />
          {w.faction} <span className="text-text">{int(w.value)}</span> ({pct(w.value, of, 0)})
        </span>
      ))}
    </div>
  );
}

/**
 * Rounds split by server, map, day or hour: a bar of who won each. `compact` puts a row on one
 * line (long lists), otherwise the wins are written out under the bar.
 */
function SplitList({ splits, factions, compact, note }: { splits: Split[]; factions: string[]; compact?: boolean; note?: (s: Split) => string }) {
  return (
    <ul className={compact ? 'space-y-1.5' : 'space-y-5'}>
      {splits.map((s) => {
        const parts = factions.map((f) => ({ faction: f, value: s.wins[f] ?? 0 }));
        const stats = note ? note(s) : `${int(s.rounds)} ${s.rounds === 1 ? 'round' : 'rounds'} · ${pct(s.big, s.rounds, 0)} big wins · closeness ${Math.round(s.closeness)}`;
        return compact ? (
          <li key={s.key} className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[5.5rem_1fr_15rem]">
            <span className="tabular-nums">{s.key}</span>
            <Bar label={`${s.key}: ${parts.map((p) => `${p.faction} ${p.value}`).join(', ')}`} parts={parts} />
            <span className="col-start-2 text-xs text-muted tabular-nums sm:col-start-3">{stats}</span>
          </li>
        ) : (
          <li key={s.key} className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">{s.key}</span>
              <span className="text-xs text-muted tabular-nums">{stats}</span>
            </div>
            <Bar label={`${s.key}: ${parts.map((p) => `${p.faction} ${p.value}`).join(', ')}`} parts={parts} />
            <Legend parts={parts} of={s.rounds} />
          </li>
        );
      })}
    </ul>
  );
}

function SideTable({ sides, winner }: { sides: Side[]; winner: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-muted">
          <tr>
            {['Side', 'Score', 'Players', 'Avg on', 'K / D', 'K/D', 'Kills/min', 'Deaths/min', 'HS %', 'Avg rating', 'Win chance', 'Top 3 share', `Deaths traded (${REFRAG_SECONDS}s)`].map((h) => (
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
              <td className="px-3 py-2">{share(s.top3)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {s.teamplay ? `${int(s.teamplay.traded)} of ${int(s.teamplay.deaths)} · ${share(tradeRate(s.teamplay))}` : '—'}
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
    if (a) rows.push({ serverId: r.serverId, server: server.shortName, matchId: r.matchId, endedAt: r.endedAt, map: r.map, a, lines: r.lines });
  }
  // Names only label the loyalty lists; the page still works without them.
  const names = await seasonNames().catch(() => new Map<string, string>());
  return { data: { rows: rows.reverse(), servers, names, ratings: ratings() }, stale: false, missing: [] as string[] };
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
          {({ rows, servers, names, ratings }) => {
            const totals = sideTotals(rows.map((r) => r.a));
            const big = rows.filter((r) => r.a.band === 'one-sided' || r.a.band === 'landslide');
            const withFeed = rows.filter((r) => r.a.sides.some((s) => s.teamplay)).length;
            const cal = calibration(rows.map((r) => r.a));
            const listed = (band ? rows.filter((r) => r.a.band === band) : rows).slice(0, ROUND_LIST_MAX);
            const factions = totals.map((t) => t.faction);
            const perServer = splitBy(rows.map((r) => ({ key: r.server, a: r.a }))).sort((x, y) => servers.findIndex((s) => s.shortName === x.key) - servers.findIndex((s) => s.shortName === y.key));
            const perMap = splitBy(rows.map((r) => ({ key: r.map ?? 'Unknown', a: r.a }))).sort((x, y) => y.rounds - x.rounds);
            const perDay = splitBy([...rows].reverse().map((r) => ({ key: dayOf(r.endedAt).slice(5), a: r.a })));
            const perHour = splitBy(
              [...rows]
                .sort((x, y) => new Date(x.endedAt * 1000).getUTCHours() - new Date(y.endedAt * 1000).getUTCHours())
                .map((r) => {
                  const from = Math.floor(new Date(r.endedAt * 1000).getUTCHours() / HOUR_BLOCK) * HOUR_BLOCK;
                  return { key: `${String(from).padStart(2, '0')}–${String(from + HOUR_BLOCK).padStart(2, '0')}`, a: r.a };
                }),
            );
            const players = loyalty(rows);
            const loyal = players.filter((p) => p.rounds >= LOYAL_MIN_ROUNDS && p.share >= LOYAL_SHARE).sort((a, b) => b.share - a.share || b.rounds - a.rounds);
            const clans = clanSides(players, (id) => (names.get(id) ? clanTag(names.get(id)!) : null));
            const nameOf = (id: string) => names.get(id) ?? `${id.slice(0, 6)}…`;
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
                <StatGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                  <Stat label="Rounds" value={int(rows.length)} />
                  <Stat
                    label="Most wins"
                    value={totals[0] ? pct(totals[0].wins, totals[0].rounds, 0) : '—'}
                    sub={totals[0] ? `${totals[0].faction}; even is ${pct(1, totals.length, 0)}` : undefined}
                  />
                  <Stat label="Average closeness" value={rows.length ? Math.round(rows.reduce((a, r) => a + r.a.closeness, 0) / rows.length) : '—'} accent />
                  <Stat label="One-sided or landslide" value={pct(big.length, rows.length, 0)} sub={`${int(big.length)} rounds`} />
                  <Stat label="Kill feed read" value={pct(withFeed, rows.length, 0)} sub="of rounds; the rest have no feed or aren't read yet" />
                </StatGrid>

                {!rows.length ? (
                  <Empty>No rounds in this period.</Empty>
                ) : (
                  <>
                    <Panel title="Wins by server" action="An even split is a third each">
                      <Help>
                        Each bar is one server&apos;s rounds, split by who won them. If the game were perfectly even every colour would
                        take about a third. Big wins are one-sided rounds and landslides; closeness is the average for that server.
                      </Help>
                      <SplitList splits={perServer} factions={factions} />
                    </Panel>

                    <Panel title="Each side" flush action="Compare win rate with what ratings expected">
                      <Help flush>
                        Win rate is what happened; expected is the average chance the skill ratings gave that side before each round.
                        A win rate well above expected means it isn&apos;t only better players: look at numbers, maps and who&apos;s on it
                        below. Avg on is players on at once. Deaths traded is the share of that side&apos;s deaths a teammate avenged
                        within {REFRAG_SECONDS}s: higher means playing closer together.
                      </Help>
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

                    <Panel title="Do the ratings pick the winner?" flush action="Rounds grouped by the favourite's chance going in">
                      <Help flush>
                        Each row is rounds where the side the ratings favoured had about that chance. If the ratings are right, the
                        favourite wins about as often as predicted in every row. Wins well below the prediction mean the ratings
                        overrate the favourite, so &ldquo;Stacked on skill&rdquo; and the team balancer lean on numbers that are too
                        strong; well above, and they underrate it. Rows with few rounds swing on luck. The ratings count everyone who
                        played the round, late joiners included.
                      </Help>
                      {cal.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm tabular-nums">
                            <thead className="text-left text-xs text-muted">
                              <tr>
                                {['Favourite\'s chance', 'Rounds', 'Predicted', 'Favourite won', ''].map((h) => (
                                  <th key={h} className="px-4 py-2 font-normal whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {cal.map((g) => (
                                <tr key={g.from}>
                                  <td className="px-4 py-2 whitespace-nowrap">{bucketLabel(g)}</td>
                                  <td className="px-4 py-2">{int(g.rounds)}</td>
                                  <td className="px-4 py-2">{share(g.predicted)}</td>
                                  <td className="px-4 py-2 font-semibold">{share(g.won)}</td>
                                  <td className="w-1/3 px-4 py-2">
                                    <div className="relative h-3 bg-surface-2" role="img" aria-label={`Predicted ${share(g.predicted)}, won ${share(g.won)}`}>
                                      <div className="h-full bg-accent" style={{ width: `${g.won * 100}%` }} />
                                      <div className="absolute inset-y-[-3px] w-0.5 bg-text" style={{ left: `${g.predicted * 100}%` }} title="Predicted" />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="border-t border-line px-4 py-2 text-xs text-muted">Bar: how often the favourite won · line: what the ratings predicted.</p>
                        </div>
                      ) : (
                        <Empty>No rated rounds in this period.</Empty>
                      )}
                    </Panel>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="How close the rounds were" action="Bar length: share of all rounds · colours: who won">
                        <Help>
                          Every round falls in one band by its closeness score. The longer the bar, the more of all rounds landed there;
                          the colours show who won them. Healthy looks like long Close and Fair bars, with every colour in each.
                          Click a band to list those rounds.
                        </Help>
                        <ul className="space-y-5">
                          {BANDS.map((b) => {
                            const inBand = rows.filter((r) => r.a.band === b.band);
                            const won = totals.map((t) => ({ faction: t.faction, value: inBand.filter((r) => r.a.winner === t.faction).length }));
                            return (
                              <li key={b.band} className="space-y-1.5 text-sm">
                                <div className="flex items-baseline justify-between gap-3">
                                  <Link prefetch={false} href={href({ band: b.band })} className="link font-medium">{b.label}</Link>
                                  <span className="text-xs text-muted tabular-nums">
                                    {int(inBand.length)} rounds · {pct(inBand.length, rows.length, 0)}
                                  </span>
                                </div>
                                <div className="h-4 w-full bg-surface-2">
                                  {inBand.length > 0 && (
                                    <div className="h-full" style={{ width: `${(inBand.length / rows.length) * 100}%`, minWidth: '0.5rem' }}>
                                      <Bar label={`${b.label} rounds by winner`} parts={won} plain />
                                    </div>
                                  )}
                                </div>
                                {inBand.length > 0 && <Legend parts={won} of={inBand.length} />}
                              </li>
                            );
                          })}
                        </ul>
                      </Panel>
                      <Panel title="Why the big wins happened" flush action="One-sided and landslide wins; a round can have several reasons">
                        <Help flush>
                          For each side&apos;s one-sided and landslide wins: how many had each reason, and what share of its big wins that is.
                          If most of one side&apos;s big wins are &ldquo;Even stats&rdquo;, they aren&apos;t bigger, better rated or shooting better:
                          it points at teamwork and communication.
                        </Help>
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

                    <Panel title="Wins by map" action="Most played first">
                      <Help>
                        The same bars as by server, per map. If one side only dominates on a few maps, look at those maps&apos; spawns and
                        objectives before the players. A map with few rounds can swing on luck, so weigh the round count.
                      </Help>
                      <SplitList splits={perMap} factions={factions} />
                    </Panel>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="Win share over time" action="By UTC day, oldest first">
                        <Help>
                          One bar per day, split by who won. Look for the day a colour started taking over: match it to a game update,
                          a map rotation change or a group arriving, and check here that a fix actually worked. Pick Season above for the
                          whole picture.
                        </Help>
                        <SplitList splits={perDay} factions={factions} compact />
                      </Panel>
                      <Panel title="Time of day" action={`${HOUR_BLOCK}-hour blocks, UTC`}>
                        <Help>
                          Rounds by when they ended (UTC; the UK is UTC in winter). If one side only dominates at certain hours, it&apos;s
                          probably who is online then, a group or a quiet server, rather than the game.
                        </Help>
                        <SplitList splits={perHour} factions={factions} compact />
                      </Panel>
                    </div>

                    <Panel title="Carry check" flush action="Share of a side's kills made by its top 3 killers">
                      <Help flush>
                        How much each side leant on its three best killers. With the same share when winning and losing, the side wins
                        as a team. If wins have a much higher share, a few strong players are carrying those rounds: watch who they are
                        in the round breakdowns.
                      </Help>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm tabular-nums">
                          <thead className="text-left text-xs text-muted">
                            <tr>
                              {['Side', 'Top 3 share when won', 'Top 3 share when lost'].map((h) => (
                                <th key={h} className="px-4 py-2 font-normal whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {totals.map((t) => (
                              <tr key={t.faction}>
                                <td className="px-4 py-2"><FactionTag name={t.faction} /></td>
                                <td className="px-4 py-2">{share(t.carryWon)}</td>
                                <td className="px-4 py-2">{share(t.carryLost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="Clans by side" action="Clans with 3 or more players in these rounds">
                        <Help>
                          Every round a clan&apos;s members played, split by side. A clan spread evenly shows about a third per colour; a
                          clan stacked on one side shows one long colour. An organised group on one side is the likeliest cause of
                          landslides with even stats. Tags are read from names on the season board.
                        </Help>
                        {clans.length ? (
                          <SplitList
                            splits={clans.slice(0, 15).map((c) => ({ key: `[${c.tag}] · ${c.members}`, rounds: c.rounds, wins: c.sides, big: 0, closeness: 0 }))}
                            factions={factions}
                            compact
                            note={(c) => `${int(c.rounds)} player-rounds`}
                          />
                        ) : (
                          <Empty>No clans in these rounds.</Empty>
                        )}
                      </Panel>
                      <Panel title="Players who keep to one side" flush action={`${LOYAL_MIN_ROUNDS}+ rounds, ${pct(LOYAL_SHARE, 1, 0)}+ on one side`}>
                        <Help flush>
                          Regulars who play most of their rounds on the same side, most one-sided first. Picking a favourite is normal;
                          a cluster of strong (high rating) players all on the winning side is stacking.
                        </Help>
                        {loyal.length ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm tabular-nums">
                              <thead className="text-left text-xs text-muted">
                                <tr>
                                  {['Player', 'Side', 'Share', 'Rounds', 'Rating'].map((h) => (
                                    <th key={h} className="px-4 py-2 font-normal whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {loyal.slice(0, LOYAL_LIST_MAX).map((p) => {
                                  const r = ratings?.get(p.steamId);
                                  return (
                                    <tr key={p.steamId}>
                                      <td className="max-w-48 truncate px-4 py-2">
                                        <Link prefetch={false} href={`/players/${p.steamId}`} className="link">{nameOf(p.steamId)}</Link>
                                      </td>
                                      <td className="px-4 py-2 whitespace-nowrap"><FactionTag name={p.faction} /></td>
                                      <td className="px-4 py-2 font-semibold">{pct(p.share, 1, 0)}</td>
                                      <td className="px-4 py-2">{int(p.rounds)}</td>
                                      <td className="px-4 py-2">{r ? r.rating.toFixed(1) : '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <Empty>No regular sticks to one side in this period.</Empty>
                        )}
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
                      <Help flush>
                        Each row: closeness score, its band, the final score as a bar, and the main reason. Open a row for every reason
                        and the side-by-side stats; the bold row is the winner. Win chance is from ratings before the round started.
                      </Help>
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
