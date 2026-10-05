import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/player';
import { Container, Empty, PageHeader, Panel, cx } from '@/components/ui';
import { duration, int, kd, metres, pct } from '@/lib/format';
import { causeLabel } from '@/lib/game';
import { safe } from '@/components/section';
import { getPlayer, headToHead, searchPlayers } from '@/lib/server/data';
import type { Loaded, PlayerProfile } from '@/lib/server/views';
import { one } from '@/lib/url';

export const metadata: Metadata = { title: 'Compare players' };

type Resolved = Loaded<PlayerProfile> | 'none' | 'warming' | Error;

/** Accepts a Steam ID or a name; a name resolves to the best search match. */
async function resolve(input: string | undefined): Promise<Resolved | null> {
  const v = input?.trim();
  if (!v) return null;
  let steamId = v;
  if (!/^\d{17}$/.test(v)) {
    const hits = await safe(searchPlayers(v));
    if (hits instanceof Error) return hits;
    if (hits === 'warming') return 'warming';
    if (!hits[0]) return 'none';
    steamId = hits[0].steamId;
  }
  return (await safe(getPlayer(steamId))) ?? 'none';
}

function PlayerInput({ name, value, label }: { name: string; value?: string; label: string }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="eyebrow mb-1.5 block !text-[0.66rem]">{label}</span>
      <input
        name={name}
        defaultValue={value}
        placeholder="Name or Steam ID"
        className="h-11 w-full border border-line-strong bg-bg px-3 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}

export default async function ComparePage({ searchParams }: PageProps<'/compare'>) {
  const sp = await searchParams;
  const qa = one(sp.a);
  const qb = one(sp.b);
  const [ra, rb] = await Promise.all([resolve(qa), resolve(qb)]);
  const a = ra && typeof ra === 'object' && !(ra instanceof Error) ? ra : null;
  const b = rb && typeof rb === 'object' && !(rb instanceof Error) ? rb : null;
  const down = ra instanceof Error || rb instanceof Error;
  const warming = ra === 'warming' || rb === 'warming';
  const h2hLoaded = a && b ? await safe(headToHead(a.data.steamId, b.data.steamId)) : null;
  const h2h = h2hLoaded && !(h2hLoaded instanceof Error) ? h2hLoaded.data : null;

  const rows: { label: string; a: number; b: number; fmt: (v: number) => string; lowerBetter?: boolean }[] = [];
  if (a && b) {
    const ta = a.data.totals;
    const tb = b.data.totals;
    rows.push(
      { label: 'Kills', a: ta.kills, b: tb.kills, fmt: int },
      { label: 'Deaths', a: ta.deaths, b: tb.deaths, fmt: int, lowerBetter: true },
      {
        label: 'K/D',
        a: ta.kills / Math.max(1, ta.deaths),
        b: tb.kills / Math.max(1, tb.deaths),
        fmt: (v) => v.toFixed(2),
      },
      {
        label: 'Headshot %',
        a: ta.kills ? ta.headshots / ta.kills : 0,
        b: tb.kills ? tb.headshots / tb.kills : 0,
        fmt: (v) => `${(v * 100).toFixed(1)}%`,
      },
      {
        label: 'Kills / hour',
        a: ta.playtime ? (ta.kills * 3600) / ta.playtime : 0,
        b: tb.playtime ? (tb.kills * 3600) / tb.playtime : 0,
        fmt: (v) => v.toFixed(1),
      },
      { label: 'Longest kill', a: ta.longest, b: tb.longest, fmt: metres },
      { label: 'Playtime', a: ta.playtime, b: tb.playtime, fmt: duration },
      { label: 'Rounds', a: ta.matches, b: tb.matches, fmt: int },
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Tools"
        title="Compare players"
        description="Put two players side by side, including how often they have killed each other."
      >
        <form className="mt-8 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
          <PlayerInput name="a" value={qa} label="Player one" />
          <PlayerInput name="b" value={qb} label="Player two" />
          <button className="h-11 bg-accent px-6 font-display text-sm font-bold uppercase tracking-[0.12em] text-accent-ink hover:opacity-90">
            Compare
          </button>
        </form>
      </PageHeader>
      <Container className="mt-8">
        {!a || !b ? (
          <Panel>
            <Empty>
              {down
                ? 'Stats are temporarily unavailable. Try again in a minute.'
                : warming
                  ? 'Search is warming up. Try again in a moment.'
                  : qa || qb
                    ? `Could not find ${!a && qa ? `“${qa}”` : ''}${!a && qa && !b && qb ? ' or ' : ''}${!b && qb ? `“${qb}”` : ''}${!qa || !qb ? 'both players' : ''}.`
                    : 'Enter two players to compare.'}
            </Empty>
          </Panel>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 panel p-5">
              {[a.data, b.data].map((p, i) => (
                <Link
                  key={p.steamId}
                  href={`/players/${p.steamId}`}
                  className={cx(
                    'flex min-w-0 items-center gap-4',
                    i === 1 && 'col-start-3 flex-row-reverse text-right',
                  )}
                >
                  <Avatar name={p.name} steamId={p.steamId} url={p.avatarUrl} size={56} />
                  <div className="min-w-0">
                    <div className="display truncate text-2xl leading-none">{p.name}</div>
                    <div className="mt-1 text-xs text-muted">Main: {causeLabel(p.weapons[0]?.cause)}</div>
                  </div>
                </Link>
              ))}
              {h2h && (
                <div className="col-start-2 row-start-1 text-center">
                  <div className="eyebrow !text-[0.62rem]">Head to head</div>
                  <div className="display num text-3xl leading-none">
                    <span className={cx(h2h.aKills > h2h.bKills && 'text-accent')}>{h2h.aKills}</span>
                    <span className="mx-2 text-dim">–</span>
                    <span className={cx(h2h.bKills > h2h.aKills && 'text-accent')}>{h2h.bKills}</span>
                  </div>
                </div>
              )}
            </div>
            <Panel flush>
              <table className="table">
                <tbody>
                  {rows.map((r) => {
                    const aWins = r.lowerBetter ? r.a < r.b : r.a > r.b;
                    const bWins = r.lowerBetter ? r.b < r.a : r.b > r.a;
                    const total = r.a + r.b || 1;
                    return (
                      <tr key={r.label}>
                        <td
                          className={cx(
                            'r w-2/5 !text-base font-display font-bold',
                            aWins ? 'text-accent' : 'text-muted',
                          )}
                        >
                          {r.fmt(r.a)}
                        </td>
                        <td className="w-1/5 text-center">
                          <div className="eyebrow !text-[0.66rem]">{r.label}</div>
                          <div className="mt-1.5 flex h-1 bg-surface-3">
                            <div className="h-full bg-accent" style={{ width: `${(r.a / total) * 100}%` }} />
                            <div className="h-full bg-muted/60" style={{ width: `${(r.b / total) * 100}%` }} />
                          </div>
                        </td>
                        <td
                          className={cx(
                            'w-2/5 !text-base font-display font-bold',
                            bWins ? 'text-accent' : 'text-muted',
                          )}
                        >
                          {r.fmt(r.b)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
            <p className="text-xs text-dim">
              K/D {kd(a.data.totals.kills, a.data.totals.deaths)} vs {kd(b.data.totals.kills, b.data.totals.deaths)}{' '}
              all-time · headshot rates {pct(a.data.totals.headshots, a.data.totals.kills)} vs{' '}
              {pct(b.data.totals.headshots, b.data.totals.kills)}.
            </p>
          </div>
        )}
      </Container>
    </>
  );
}
