'use client';

import { useId, useMemo, useState, useSyncExternalStore, type PointerEvent } from 'react';
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

function timeLabel(t: number, span: number): string {
  const d = new Date(t * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (span <= 2 * 86400) return `${hh}:${mm}`;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

function fullTime(t: number): string {
  const d = new Date(t * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${hh}:${mm} UTC`;
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
              <span className="ml-2 text-muted">{fullTime(hp.t)}</span>
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
              {timeLabel(t0 + span * f, span)}
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
 * Average players by weekday and hour, from population buckets (each spread over the hours it covers).
 * utcOffsetMinutes: the viewer's offset, so the grid reads in their own time. Cells with no data are null.
 */
export function weekGrid(
  points: { ts: number; players: number }[],
  bucketSeconds: number,
  utcOffsetMinutes: number,
): (number | null)[][] {
  const sum = DAYS.map(() => Array<number>(24).fill(0));
  const n = DAYS.map(() => Array<number>(24).fill(0));
  const hours = Math.max(1, Math.round(bucketSeconds / 3600));
  for (const p of points) {
    for (let h = 0; h < hours; h++) {
      const d = new Date((p.ts + h * 3600 + utcOffsetMinutes * 60) * 1000);
      const day = (d.getUTCDay() + 6) % 7; // Monday first
      sum[day][d.getUTCHours()] += p.players;
      n[day][d.getUTCHours()] += 1;
    }
  }
  return sum.map((row, d) => row.map((v, h) => (n[d][h] ? v / n[d][h] : null)));
}

/** When a server is usually busy: a weekday x hour grid in the viewer's timezone (UTC until hydrated). */
export function BusyTimes({ points, bucketSeconds }: { points: { ts: number; players: number }[]; bucketSeconds: number }) {
  // The server renders UTC; the browser swaps in its own offset after hydration.
  const offset = useSyncExternalStore(noop, () => -new Date().getTimezoneOffset(), () => 0);
  const local = useSyncExternalStore(noop, () => true, () => false);
  const grid = useMemo(() => weekGrid(points, bucketSeconds, offset), [points, bucketSeconds, offset]);
  const max = Math.max(1, ...grid.flat().map((v) => v ?? 0));
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const shown = hover && grid[hover.d][hover.h];
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <div>
      <div className="grid grid-cols-[2.25rem_1fr] gap-x-2">
        <div />
        <div className="mb-1 grid grid-cols-[repeat(24,1fr)] text-[10px] text-dim">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="num">
              {h % 6 === 0 ? hh(h).slice(0, 2) : ''}
            </span>
          ))}
        </div>
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="font-display text-[11px] leading-[1.1rem] font-semibold uppercase tracking-[0.1em] text-dim">
              {DAYS[d]}
            </span>
            <div className="mb-px grid grid-cols-[repeat(24,1fr)] gap-px" onPointerLeave={() => setHover(null)}>
              {row.map((v, h) => (
                <span
                  key={h}
                  onPointerEnter={() => setHover({ d, h })}
                  title={`${DAYS[d]} ${hh(h)} · ${v == null ? 'no data' : `~${Math.round(v)} players`}`}
                  className={cx('h-[1.1rem]', v == null ? 'bg-surface-2' : 'bg-accent', hover?.d === d && hover.h === h && 'outline outline-1 outline-text')}
                  style={v == null ? undefined : { opacity: 0.08 + 0.92 * (v / max) }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="num">
          {hover
            ? `${DAYS[hover.d]} ${hh(hover.h)} · ${shown == null ? 'no data' : `about ${Math.round(shown)} players`}`
            : local
              ? `Your time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
              : 'UTC'}
        </span>
        <span className="flex items-center gap-1.5">
          Quiet
          <span className="flex h-2 w-16 bg-gradient-to-r from-accent/10 to-accent" />
          Busy
        </span>
      </div>
    </div>
  );
}
