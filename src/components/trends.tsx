'use client';
// A player's trends: per-day bars (kills, playtime, rounds) and lines (K/D, win rate, skill rating,
// all-time kills place), from history.db through lib/server/trends.ts. Days are UTC.

import { useMemo, useState } from 'react';
import { BarChart } from './charts';
import { cx } from './ui';

export interface TrendDayView {
  day: string;
  rounds: number;
  kills: number;
  deaths: number;
  seconds: number;
  wins: number;
  rating: number | null;
}

const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/**
 * A line over its own range (not from zero), for values like a rating that live far from zero.
 * invert: lower is better (a place on a board), so the line climbs as it falls.
 */
export function LineChart({
  points,
  invert = false,
  format = (v) => String(Math.round(v)),
  height = 160,
}: {
  points: { label: string; v: number | null }[];
  invert?: boolean;
  format?: (v: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const known = points.map((p) => p.v).filter((v): v is number => v != null);
  if (known.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
        Not enough days yet.
      </div>
    );
  }
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.01, 0.5);
  const min = lo - pad;
  const max = hi + pad;
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => {
    const f = (v - min) / (max - min);
    return (invert ? f : 1 - f) * 100;
  };
  // Gaps where a day has no value: a new segment after each.
  let path = '';
  let open = false;
  points.forEach((p, i) => {
    if (p.v == null) {
      open = false;
      return;
    }
    path += `${open ? 'L' : 'M'}${x(i).toFixed(3)},${y(p.v).toFixed(3)}`;
    open = true;
  });
  const hp = hover != null ? points[hover] : null;
  const top = invert ? lo : hi;
  const bottom = invert ? hi : lo;
  return (
    <div>
      <div className="mb-2 h-4 text-xs text-muted">
        {hp ? (
          <>
            <span className="num font-semibold text-text">{hp.v == null ? 'No rounds' : format(hp.v)}</span>
            <span className="ml-2">{hp.label}</span>
          </>
        ) : (
          <span className="text-dim">Hover for each day</span>
        )}
      </div>
      <div className="relative pl-10" style={{ height }}>
        <div className="absolute inset-y-0 left-0 w-9 text-right text-[10px] text-dim">
          <span className="num absolute right-0" style={{ top: `${y(top)}%`, transform: 'translateY(-50%)' }}>
            {format(top)}
          </span>
          <span className="num absolute right-0" style={{ top: `${y(bottom)}%`, transform: 'translateY(-50%)' }}>
            {format(bottom)}
          </span>
        </div>
        <div
          className="relative h-full border-b border-line"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.min(points.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
          }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {[top, bottom].map((v) => (
              <line key={v} x1="0" x2="100" y1={y(v)} y2={y(v)} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(hover)}%` }} />
          )}
          {hp?.v != null && (
            <div
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
              style={{ left: `${x(hover!)}%`, top: `${y(hp.v)}%` }}
            />
          )}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-10 text-[10px] text-dim">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

/** Every UTC day from `from` to `to` (YYYY-MM-DD), at most `limit` of the latest. */
export function dayRange(from: string, to: string, limit = 90): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out.slice(-limit);
}

type Tab = 'kills' | 'kd' | 'playtime' | 'winRate' | 'skill' | 'rank';
const TABS: { key: Tab; label: string }[] = [
  { key: 'kills', label: 'Kills' },
  { key: 'kd', label: 'K/D' },
  { key: 'playtime', label: 'Playtime' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'skill', label: 'Skill' },
  { key: 'rank', label: 'Kills rank' },
];

const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);

export function PlayerTrends({
  days,
  killsRank,
  from,
  today,
}: {
  days: TrendDayView[];
  killsRank: { day: string; rank: number }[];
  /** the first day to chart: the season's start */
  from: string;
  today: string;
}) {
  const tabs = TABS.filter((t) => (t.key === 'rank' ? killsRank.length > 1 : t.key === 'skill' ? days.some((d) => d.rating != null) : true));
  const [tab, setTab] = useState<Tab>('kills');
  const range = useMemo(() => dayRange(from, today), [from, today]);
  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  // Rating carries over days off: it only changes when they play.
  const ratingAt = useMemo(() => {
    const out: (number | null)[] = [];
    for (const day of range) out.push(byDay.get(day)?.rating ?? out.at(-1) ?? null);
    return out;
  }, [range, byDay]);
  const rankAt = useMemo(() => {
    const m = new Map(killsRank.map((r) => [r.day, r.rank]));
    return range.map((day) => m.get(day) ?? null);
  }, [range, killsRank]);
  const totals = days.reduce((a, d) => ({ kills: a.kills + d.kills, deaths: a.deaths + d.deaths, seconds: a.seconds + d.seconds, rounds: a.rounds + d.rounds }), { kills: 0, deaths: 0, seconds: 0, rounds: 0 });

  const chart = (() => {
    switch (tab) {
      case 'kills':
        return <BarChart bars={range.map((day) => ({ label: short(day), value: byDay.get(day)?.kills ?? 0, detail: `${byDay.get(day)?.kills ?? 0} kills` }))} height={160} />;
      case 'playtime':
        return <BarChart bars={range.map((day) => ({ label: short(day), value: byDay.get(day)?.seconds ?? 0, detail: hm(byDay.get(day)?.seconds ?? 0) }))} height={160} />;
      case 'kd':
        return (
          <LineChart
            points={range.map((day) => {
              const d = byDay.get(day);
              return { label: short(day), v: d && d.rounds ? d.kills / Math.max(1, d.deaths) : null };
            })}
            format={(v) => v.toFixed(2)}
          />
        );
      case 'winRate':
        return (
          <LineChart
            points={range.map((day) => {
              const d = byDay.get(day);
              return { label: short(day), v: d && d.rounds ? (d.wins / d.rounds) * 100 : null };
            })}
            format={(v) => `${Math.round(v)}%`}
          />
        );
      case 'skill':
        return <LineChart points={range.map((day, i) => ({ label: short(day), v: ratingAt[i] }))} />;
      case 'rank':
        return <LineChart points={range.map((day, i) => ({ label: short(day), v: rankAt[i] }))} invert format={(v) => `#${Math.round(v)}`} />;
    }
  })();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div role="tablist" aria-label="Trend" className="inline-flex border border-line-strong bg-surface">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx(
                  'px-3 py-1.5 font-display text-[12px] font-semibold whitespace-nowrap uppercase tracking-[0.1em] transition-colors',
                  tab === t.key ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-3 hover:text-text',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <span className="num text-xs text-muted">
          {totals.rounds} rounds · {totals.kills} kills · K/D {(totals.kills / Math.max(1, totals.deaths)).toFixed(2)} · {hm(totals.seconds)}
        </span>
      </div>
      {chart}
    </div>
  );
}

type NetTab = 'players' | 'rounds' | 'kills' | 'hours';
const NET_TABS: { key: NetTab; label: string; detail: (n: number) => string }[] = [
  { key: 'players', label: 'Players', detail: (n) => `${n} different players` },
  { key: 'rounds', label: 'Rounds', detail: (n) => `${n} rounds` },
  { key: 'kills', label: 'Kills', detail: (n) => `${n.toLocaleString('en-GB')} kills` },
  { key: 'hours', label: 'Hours played', detail: (n) => `${n.toLocaleString('en-GB')} hours` },
];

/** The network day by day this season: different players, rounds, kills and hours played. */
export function NetworkActivity({ days, from, today }: { days: { day: string; rounds: number; players: number; kills: number; seconds: number }[]; from: string; today: string }) {
  const [tab, setTab] = useState<NetTab>('players');
  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  const t = NET_TABS.find((x) => x.key === tab)!;
  const value = (day: string) => {
    const d = byDay.get(day);
    if (!d) return 0;
    return tab === 'hours' ? Math.round(d.seconds / 3600) : d[tab];
  };
  return (
    <div>
      <div role="tablist" aria-label="Activity" className="mb-4 inline-flex border border-line-strong bg-surface">
        {NET_TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={cx(
              'px-3 py-1.5 font-display text-[12px] font-semibold whitespace-nowrap uppercase tracking-[0.1em] transition-colors',
              tab === x.key ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-3 hover:text-text',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      <BarChart bars={dayRange(from, today).map((day) => ({ label: short(day), value: value(day), detail: t.detail(value(day)) }))} height={150} />
    </div>
  );
}
