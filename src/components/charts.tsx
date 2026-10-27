'use client';

import { useId, useMemo, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { dayMonth, hourMinute } from '@/lib/format';
import { useViewerTz } from './local-time';
import { cx } from './ui';

export interface Point {
  t: number;
  v: number;
}

const H = 100;

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => n <= c) ?? 10;
  return step * mag;
}

/** Axis labels and hover times are in the viewer's timezone (UTC until the browser takes over). */
function timeLabel(t: number, span: number, tz: string): string {
  return span <= 2 * 86400 ? hourMinute(t, tz) : dayMonth(t, tz);
}

function fullTime(t: number, tz: string): string {
  return `${dayMonth(t, tz)} ${hourMinute(t, tz)}${tz === 'UTC' ? ' UTC' : ''}`;
}

/**
 * Filled line chart. The plot scales to its box; labels are HTML so they stay crisp at any width.
 * `capacity` draws a dashed ceiling line (e.g. max players).
 */
export function AreaChart({
  points,
  capacity,
  height = 180,
  unit = '',
  color = 'var(--accent)',
}: {
  points: Point[];
  capacity?: number;
  height?: number;
  unit?: string;
  color?: string;
}) {
  const id = useId();
  const tz = useViewerTz();
  const [hover, setHover] = useState<number | null>(null);
  const { path, area, max, t0, t1 } = useMemo(() => {
    const t0 = points[0]?.t ?? 0;
    const t1 = points[points.length - 1]?.t ?? 1;
    const max = niceMax(Math.max(capacity ?? 0, ...points.map((p) => p.v)));
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100;
    const y = (v: number) => H - (v / max) * H;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(3)},${y(p.v).toFixed(3)}`).join('');
    return { path: line, area: points.length ? `${line}L100,${H}L0,${H}Z` : '', max, t0, t1 };
  }, [points, capacity]);

  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
        Not enough data yet.
      </div>
    );
  }

  const span = t1 - t0;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * span;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };
  const hp = hover != null ? points[hover] : null;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="relative select-none pl-9 pb-6" style={{ height }}>
      <div className="absolute top-0 bottom-6 left-0 w-7">
        {[0, 0.5, 1].map((f) => (
          <div
            key={f}
            className="num absolute right-0 -translate-y-1/2 text-[10px] text-dim"
            style={{ top: `${(1 - f) * 100}%` }}
          >
            {Math.round(max * f)}
          </div>
        ))}
      </div>
      <div className="relative h-full" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.28" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1="0"
              x2="100"
              y1={H * f}
              y2={H * f}
              stroke="var(--line)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {capacity ? (
            <line
              x1="0"
              x2="100"
              y1={H - (capacity / max) * H}
              y2={H - (capacity / max) * H}
              stroke="var(--dim)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <path d={area} fill={`url(#${id})`} />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        {hp && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
              style={{ left: `${((hp.t - t0) / span) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg"
              style={{ left: `${((hp.t - t0) / span) * 100}%`, top: `${(1 - hp.v / max) * 100}%`, background: color }}
            />
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 border border-line-strong bg-surface-2 px-2 py-1 text-xs whitespace-nowrap shadow-lg"
              style={{ left: `clamp(60px, ${((hp.t - t0) / span) * 100}%, calc(100% - 60px))` }}
            >
              <span className="num font-semibold text-text">
                {hp.v}
                {unit}
              </span>
              <span className="ml-2 text-muted">{fullTime(hp.t, tz)}</span>
            </div>
          </>
        )}
        <div className="absolute inset-x-0 -bottom-6 h-6">
          {ticks.map((f) => (
            <span
              key={f}
              className="num absolute top-1.5 text-[10px] text-dim"
              style={{ left: `${f * 100}%`, transform: `translateX(${f === 0 ? '0' : f === 1 ? '-100%' : '-50%'})` }}
            >
              {timeLabel(t0 + span * f, span, tz)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Vertical bars with a hover readout, e.g. kills per day. */
export function BarChart({
  bars,
  height = 140,
  color = 'var(--accent)',
}: {
  bars: { label: string; value: number; detail?: string }[];
  height?: number;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value)));
  const hb = hover != null ? bars[hover] : null;
  return (
    <div className="relative">
      <div className="mb-2 h-4 text-xs text-muted">
        {hb ? (
          <>
            <span className="num font-semibold text-text">{hb.detail ?? hb.value}</span>
            <span className="ml-2">{hb.label}</span>
          </>
        ) : (
          <span className="text-dim">Hover a bar for detail</span>
        )}
      </div>
      <div
        className="flex items-end gap-[3px] border-b border-line"
        style={{ height }}
        onPointerLeave={() => setHover(null)}
      >
        {bars.map((b, i) => (
          <div
            key={b.label}
            className="group flex h-full flex-1 items-end"
            onPointerEnter={() => setHover(i)}
            aria-label={`${b.label}: ${b.detail ?? b.value}`}
          >
            <div
              className="w-full transition-opacity"
              style={{
                height: `${(b.value / max) * 100}%`,
                minHeight: b.value ? 2 : 0,
                background: color,
                opacity: hover == null || hover === i ? 1 : 0.35,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-dim">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
    </div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const noop = () => () => {};

/**
 * Average players by weekday and hour, from population buckets. Each bucket counts towards every hour
 * it overlaps, weighted by how much of that hour it covers, so ten-minute and six-hour buckets mix
 * fairly. utcOffsetMinutes: the viewer's offset, so the grid reads in their own time. Cells with no
 * data are null.
 */
export function weekGrid(
  points: { ts: number; players: number }[],
  bucketSeconds: number,
  utcOffsetMinutes: number,
): (number | null)[][] {
  return weekGridFrom([{ points, bucketSeconds }], utcOffsetMinutes);
}

export function weekGridFrom(series: Series[], utcOffsetMinutes: number): (number | null)[][] {
  const sum = DAYS.map(() => Array<number>(24).fill(0));
  const w = DAYS.map(() => Array<number>(24).fill(0));
  for (const { points, bucketSeconds } of series) {
    const len = Math.max(60, bucketSeconds);
    for (const p of points) {
      let t = p.ts + utcOffsetMinutes * 60;
      const end = t + len;
      while (t < end) {
        const next = Math.min(end, (Math.floor(t / 3600) + 1) * 3600);
        const d = new Date(t * 1000);
        const day = (d.getUTCDay() + 6) % 7; // Monday first
        const share = (next - t) / 3600;
        sum[day][d.getUTCHours()] += p.players * share;
        w[day][d.getUTCHours()] += share;
        t = next;
      }
    }
  }
  return sum.map((row, d) => row.map((v, h) => (w[d][h] ? v / w[d][h] : null)));
}

/**
 * The month's buckets up to where the week starts, then the week's: the last seven days at the week's
 * finer grain where it has one, the rest of the month for history.
 */
export function busySeries(month: Series, week: Series): Series[] {
  const from = week.points[0]?.ts;
  if (from == null || !week.bucketSeconds || week.bucketSeconds >= month.bucketSeconds) return [month];
  return [{ ...month, points: month.points.filter((p) => p.ts + month.bucketSeconds <= from) }, week];
}

/**
 * A cell's shade, 0 (nobody) to 5 (the busiest hour of the week), stepped from the quietest hour (lo)
 * up, so a server that never empties still shows when it peaks.
 */
export function busyLevel(v: number, max: number, lo = 0): number {
  if (v <= 0 || max <= 0) return 0;
  const span = max - lo;
  return Math.min(5, Math.max(1, Math.ceil(span > 0 ? ((v - lo) / span) * 5 : 5)));
}

/**
 * The latest day on a weekday (Monday 0) in the viewer's time, from population buckets: minutes past
 * midnight and players, plus that day's local date. Null when no bucket falls on that weekday.
 */
export function lastDay(
  points: { ts: number; players: number }[],
  utcOffsetMinutes: number,
  weekday: number,
): { date: string; points: { m: number; v: number }[] } | null {
  const local = (ts: number) => new Date((ts + utcOffsetMinutes * 60) * 1000);
  const days = points.filter((p) => (local(p.ts).getUTCDay() + 6) % 7 === weekday);
  if (!days.length) return null;
  const date = local(days[days.length - 1].ts).toISOString().slice(0, 10);
  return {
    date,
    points: days
      .filter((p) => local(p.ts).toISOString().slice(0, 10) === date)
      .map((p) => {
        const d = local(p.ts);
        return { m: d.getUTCHours() * 60 + d.getUTCMinutes(), v: p.players };
      }),
  };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** One weekday hour by hour: the latest such day as a filled line, its usual (the grid row) dashed. */
function DayChart({ day, usual, label }: { day: { m: number; v: number }[]; usual: (number | null)[]; label: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...day.map((p) => p.v), ...usual.map((v) => v ?? 0)));
  const x = (m: number) => (m / 1440) * 100;
  const y = (v: number) => H - (v / max) * H;
  const line = day.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(3)},${y(p.v).toFixed(3)}`).join('');
  const area = day.length > 1 ? `${line}L${x(day[day.length - 1].m)},${H}L${x(day[0].m)},${H}Z` : '';
  // Usual: each hour's average drawn across its hour, with gaps where there's no history.
  const usualPath = usual
    .map((v, h) => (v == null ? '' : `M${x(h * 60).toFixed(3)},${y(v).toFixed(3)}L${x(h * 60 + 60).toFixed(3)},${y(v).toFixed(3)}`))
    .join('');
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(1439, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * 1440))));
  };
  const near = hover == null || !day.length ? null : day.reduce((a, p) => (Math.abs(p.m - hover) < Math.abs(a.m - hover) ? p : a));
  const at = near?.m ?? hover;
  const usualAt = at == null ? null : usual[Math.floor(at / 60)];
  return (
    <div>
      <div className="relative select-none pb-6 pl-9" style={{ height: 180 }}>
        <div className="absolute top-0 bottom-6 left-0 w-7">
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="num absolute right-0 -translate-y-1/2 text-[10px] text-dim" style={{ top: `${(1 - f) * 100}%` }}>
              {Math.round(max * f)}
            </div>
          ))}
        </div>
        <div className="relative h-full" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1="0" x2="100" y1={H * f} y2={H * f} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={usualPath} fill="none" stroke="var(--muted)" strokeWidth="1.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <path d={area} fill={`url(#${id})`} />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {at != null && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(at)}%` }} />
              {near && (
                <div
                  className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
                  style={{ left: `${x(near.m)}%`, top: `${(1 - near.v / max) * 100}%` }}
                />
              )}
              <div
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 border border-line-strong bg-surface-2 px-2 py-1 text-xs whitespace-nowrap shadow-lg"
                style={{ left: `clamp(80px, ${x(at)}%, calc(100% - 80px))` }}
              >
                <span className="text-muted">{hhmm(at)}</span>
                {near && <span className="num ml-2 font-semibold text-text">{Math.round(near.v)} players</span>}
                {usualAt != null && <span className="num ml-2 text-muted">usually ~{Math.round(usualAt)}</span>}
              </div>
            </>
          )}
          <div className="absolute inset-x-0 -bottom-6 h-6">
            {[0, 6, 12, 18, 24].map((h) => (
              <span
                key={h}
                className="num absolute top-1.5 text-[10px] text-dim"
                style={{ left: `${(h / 24) * 100}%`, transform: `translateX(${h === 0 ? '0' : h === 24 ? '-100%' : '-50%'})` }}
              >
                {hhmm(h * 60)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-accent" />
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t border-dashed border-muted" />
          Usual for this day
        </span>
      </div>
    </div>
  );
}

type Series = { bucketSeconds: number; points: { ts: number; players: number }[] };

/** Opacity of each busyLevel step over the accent. */
const SHADE = [0, 0.16, 0.34, 0.55, 0.78, 1];

/**
 * When a server is usually busy: a weekday x hour grid in the viewer's timezone (UTC until hydrated),
 * shaded in five steps, with each day's peak and the hour it is now. Picking a day opens it hour by
 * hour: its latest occurrence against its usual.
 */
export function BusyTimes({ month, week }: { month: Series; week: Series }) {
  // The server renders UTC; the browser swaps in its own offset after hydration.
  const offset = useSyncExternalStore(noop, () => -new Date().getTimezoneOffset(), () => 0);
  const local = useSyncExternalStore(noop, () => true, () => false);
  // Hours since the epoch in the viewer's time: steady between renders, so a safe snapshot.
  const nowHour = useSyncExternalStore(noop, () => Math.floor((Date.now() / 1000 - new Date().getTimezoneOffset() * 60) / 3600), () => null);
  const nowAt = nowHour == null ? null : { d: (new Date(nowHour * 3600 * 1000).getUTCDay() + 6) % 7, h: nowHour % 24 };
  const grid = useMemo(() => weekGridFrom(busySeries(month, week), offset), [month, week, offset]);
  const known = grid.flat().filter((v): v is number => v != null);
  const max = Math.max(1, ...known);
  const lo = known.length ? Math.min(...known) : 0;
  const level = (v: number) => busyLevel(v, max, lo);
  const peaks = grid.map((row) => row.reduce<{ h: number; v: number } | null>((a, v, h) => (v != null && (!a || v > a.v) ? { h, v } : a), null));
  const best = peaks.reduce<{ d: number; h: number; v: number } | null>((a, p, d) => (p && (!a || p.v > a.v) ? { d, ...p } : a), null);
  const usualNow = nowAt && grid[nowAt.d][nowAt.h];
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const day = useMemo(() => (picked == null ? null : lastDay(week.points, offset, picked)), [week, offset, picked]);
  const shown = hover && grid[hover.d][hover.h];
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const pick = (d: number) => setPicked((p) => (p === d ? null : d));
  // The newest bucket is minutes old, so the day it falls on is today.
  const newest = week.points.at(-1);
  const today = newest ? new Date((newest.ts + offset * 60) * 1000).toISOString().slice(0, 10) : null;
  const dayLabel = (date: string, d: number) =>
    date === today ? 'Today so far' : `${DAYS[d]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
  if (!best) return <p className="py-6 text-center text-sm text-muted">No population history yet.</p>;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-muted">Usually busiest </span>
          <span className="font-semibold">
            {DAYS[best.d]} {hh(best.h)}
          </span>
          <span className="num text-muted"> · ~{Math.round(best.v)} players</span>
        </span>
        {usualNow != null && (
          <span>
            <span className="text-muted">This hour usually </span>
            <span className="num font-semibold">~{Math.round(usualNow)} players</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-[2.25rem_1fr_2rem] gap-x-2">
        <div />
        <div className="relative mb-1 h-3 text-[10px] text-dim">
          {Array.from({ length: 8 }, (_, i) => i * 3).map((h) => (
            <span
              key={h}
              className={cx('num absolute', h % 6 !== 0 && 'hidden sm:inline', nowAt?.h === h && 'text-accent')}
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {hh(h).slice(0, 2)}
            </span>
          ))}
        </div>
        <div className="text-right text-[10px] text-dim">Peak</div>
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <button
              type="button"
              onClick={() => pick(d)}
              aria-pressed={picked === d}
              className={cx(
                'text-left font-display text-[11px] leading-[1.4rem] font-semibold uppercase tracking-[0.1em] transition-colors',
                picked === d || nowAt?.d === d ? 'text-accent' : 'text-dim hover:text-text',
              )}
            >
              {DAYS[d]}
            </button>
            {/* The squares pick their day too; the day name is the keyboard's way in. */}
            <div
              className={cx('mb-0.5 grid cursor-pointer grid-cols-[repeat(24,1fr)] gap-0.5', picked === d && 'outline outline-1 outline-offset-1 outline-accent')}
              onPointerLeave={() => setHover(null)}
              onClick={() => pick(d)}
            >
              {row.map((v, h) => {
                const isNow = nowAt?.d === d && nowAt.h === h;
                return (
                  <span
                    key={h}
                    onPointerEnter={() => setHover({ d, h })}
                    title={`${DAYS[d]} ${hh(h)} · ${v == null ? 'no data' : `~${Math.round(v)} players`}${isNow ? ' · now' : ''}`}
                    className={cx(
                      'h-[1.4rem] rounded-[2px]',
                      v == null ? 'bg-surface-2' : level(v) ? 'bg-accent' : 'bg-surface-3',
                      hover?.d === d && hover.h === h ? 'outline outline-1 outline-text' : isNow && 'outline outline-2 -outline-offset-1 outline-text',
                    )}
                    style={v == null || !level(v) ? undefined : { opacity: SHADE[level(v)] }}
                  />
                );
              })}
            </div>
            <span className="num self-center text-right text-[11px] text-muted" title={peaks[d] ? `Busiest around ${hh(peaks[d]!.h)}` : undefined}>
              {peaks[d] ? Math.round(peaks[d]!.v) : '—'}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="num">
          {hover
            ? `${DAYS[hover.d]} ${hh(hover.h)} · ${shown == null ? 'no data' : `about ${Math.round(shown)} players`}`
            : `${local ? `Your time (${Intl.DateTimeFormat().resolvedOptions().timeZone})` : 'UTC'} · pick a day to see it hour by hour`}
        </span>
        <span className="flex items-center gap-1.5" aria-label={`Shading from ${Math.round(lo)} to ${Math.round(max)} players`}>
          <span className="num">{Math.round(lo)}</span>
          {SHADE.slice(1).map((o) => (
            <span key={o} className="size-3 rounded-[2px] bg-accent" style={{ opacity: o }} />
          ))}
          <span className="num">{Math.round(max)} players</span>
        </span>
      </div>
      {picked != null && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h3 className="display text-sm tracking-[0.06em]">{DAYS[picked]}</h3>
            <button type="button" onClick={() => setPicked(null)} className="eyebrow !text-[0.66rem] transition-colors hover:!text-accent">
              Close
            </button>
          </div>
          {day ? (
            <DayChart day={day.points} usual={grid[picked]} label={dayLabel(day.date, picked)} />
          ) : (
            <p className="py-6 text-center text-sm text-muted">No {DAYS[picked]} in the last week yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
