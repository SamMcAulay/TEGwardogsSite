'use client';
// The feed's director: rotates segments through the box with a wipe cut, a progress bar on the
// segment strip, and a take on click (a segment, or a server's scorebug). Reduced motion: no
// rotation and no camera drift; the viewer picks.
/* eslint-disable @next/next/no-img-element -- map banners at the feed's size */
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FACTIONS, factionColor } from '@/lib/game';
import { hourMinute } from '@/lib/format';
import { useViewerTz } from './local-time';

/** A time of day in the viewer's timezone, "14:05". */
export function ClockAt({ ts }: { ts: number }) {
  const tz = useViewerTz();
  return <time dateTime={new Date(ts * 1000).toISOString()}>{hourMinute(ts, tz)}</time>;
}

export interface Bug {
  id: string;
  name: string;
  scores: { name: string; score: number }[];
  /** seconds into the round, when known */
  clock: number | null;
  players: number;
  max: number | null;
}

export interface Segment {
  id: string;
  label: string;
  sub: string;
  /** the map banner behind it; null: a dark frame */
  art: string | null;
  /** darken the map: a graphic sits over it */
  dim?: boolean;
  cam: string;
  source: string;
  /** the map title bottom right */
  where?: [string, ReactNode];
  /** where the map title leads: the server's own page */
  href?: string;
  /** which scorebug this segment is about */
  bug?: number;
  /** the full-frame graphic, for data segments */
  body?: ReactNode;
}

const SEGMENT_MS = 9000;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

export function Feed({ bugs, segments, lowerThird }: { bugs: Bug[]; segments: Segment[]; lowerThird: ReactNode }) {
  const reduce = useReducedMotion();
  // Track the segment by id: each 15s refresh hands over a new list, maybe with a segment more or less.
  const [onId, setOnId] = useState(segments[0]?.id);
  // Each take adds a camera that wipes in over the last one; the old ones go once it has landed.
  const [cams, setCams] = useState<{ key: number; art: string | null; dim: boolean }[]>(() =>
    segments.length ? [{ key: 0, art: segments[0].art, dim: !!segments[0].dim }] : [],
  );
  const takes = useRef(0);
  // The director holds the shot while the viewer is pointing at or tabbed into the feed.
  const [held, setHeld] = useState(false);
  const i = Math.max(0, segments.findIndex((s) => s.id === onId));
  const seg = segments[i];
  const ids = segments.map((s) => s.id).join();

  function take(n: number) {
    const next = segments[n];
    if (!next) return;
    setOnId(next.id);
    const key = ++takes.current;
    setCams((c) => [...c.slice(-1), { key, art: next.art, dim: !!next.dim }]);
  }

  // Drop the cameras underneath once the newest has wiped in.
  useEffect(() => {
    if (cams.length < 2) return;
    const t = setTimeout(() => setCams((c) => c.slice(-1)), 800);
    return () => clearTimeout(t);
  }, [cams]);

  // The director moves on every few seconds, unless motion is reduced or the tab is hidden.
  useEffect(() => {
    if (reduce || held || segments.length < 2) return;
    const t = setTimeout(() => {
      if (!document.hidden) take((i + 1) % segments.length);
    }, SEGMENT_MS);
    return () => clearTimeout(t);
    // keyed on the ids, not the array: a refresh must not restart the segment's clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, reduce, held, ids]);

  if (!seg) return null;
  const live = cams.at(-1)?.key;
  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <section className="bc-feed" aria-label={`Feed: ${seg.label}`} data-full={seg.body ? '' : undefined}>
        {cams.map((c) => (
          <div key={c.key} className={['bc-cam', c.dim && 'bc-dim', c.key === live && cams.length > 1 && 'bc-in'].filter(Boolean).join(' ')}>
            {c.art && <img src={c.art} alt="" />}
          </div>
        ))}
        <div className="bc-camid">
          <b>{seg.cam}</b>
          <span>{seg.source}</span>
        </div>
        <div className="bc-safe">
          <div className="bc-tl">
            {bugs.map((b, n) => (
              <button
                key={b.id}
                type="button"
                className="bc-bug"
                data-on={seg.bug === n || undefined}
                data-off={(seg.bug != null && seg.bug !== n) || undefined}
                style={{ animationDelay: `${n * 0.15}s` }}
                aria-label={`${b.name}: ${b.scores.map((s) => `${s.name} ${s.score}`).join(', ')}. Show this server.`}
                onClick={() => {
                  const cam = segments.findIndex((s) => s.bug === n && !s.body);
                  if (cam >= 0) take(cam);
                }}
              >
                <span className="bc-sv">{b.name}</span>
                {b.scores.map((s) => (
                  <span key={s.name} className="bc-tm num" title={`${s.name}: ${s.score} points`}>
                    <small style={{ background: factionColor(s.name) }}>{FACTIONS[s.name]?.short ?? s.name.slice(0, 3).toUpperCase()}</small>
                    {s.score}
                  </span>
                ))}
                {b.clock != null && (
                  <span className="bc-clk num" title="Round time">
                    {mmss(b.clock)}
                  </span>
                )}
                {b.max != null && b.players >= b.max ? (
                  <span className="bc-ful" title={`${b.players} of ${b.max} slots taken`}>
                    FULL
                  </span>
                ) : (
                  <span className="bc-clk num" title={`${b.players} playing of ${b.max ?? '?'} slots`}>
                    {b.players}/{b.max ?? '—'}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div />
          <div className="bc-l3row">
            {lowerThird}
            {seg.where &&
              (seg.href ? (
                <Link href={seg.href} className="bc-where">
                  <b>{seg.where[0]}</b>
                  <span>{seg.where[1]}</span>
                  <small>Server page →</small>
                </Link>
              ) : (
                <div className="bc-where">
                  <b>{seg.where[0]}</b>
                  <span>{seg.where[1]}</span>
                </div>
              ))}
          </div>
        </div>
        {seg.body && (
          <div className="bc-gfx" key={seg.id}>
            {seg.body}
          </div>
        )}
      </section>
      <div className="bc-segs" role="group" aria-label="What the feed shows">
        {segments.map((s, n) => (
          <button key={s.id} type="button" aria-pressed={n === i} style={{ ['--dur' as string]: `${SEGMENT_MS}ms` }} onClick={() => take(n)}>
            {s.label}
            <small>{s.sub}</small>
            {/* restart the progress bar on every take */}
            {n === i && !reduce && !held && <i key={cams.at(-1)?.key} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kills or K/D for the week, as two ready-made towers. */
export function Standings({ kills, kd }: { kills: ReactNode; kd: ReactNode }) {
  const [tab, setTab] = useState<'kills' | 'kd'>('kills');
  return (
    <>
      <div className="bc-seg" role="group" aria-label="Rank by">
        <button type="button" aria-pressed={tab === 'kills'} onClick={() => setTab('kills')}>
          Kills
        </button>
        <button type="button" aria-pressed={tab === 'kd'} onClick={() => setTab('kd')}>
          K/D
        </button>
      </div>
      <div>{tab === 'kills' ? kills : kd}</div>
    </>
  );
}
