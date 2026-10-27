'use client';
// A finished round played back: drag or play through it and see the score, who's leading the
// kills and the latest kills at that moment, with the round's turning points to jump to.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clock } from '@/lib/format';
import { causeLabel } from '@/lib/game';
import { HEADSHOT, killsBefore, scoreAt, standings, SUICIDE, TEAM_KILL, turningPoints, type ReplayData } from '@/lib/replay';
import { cx } from './ui';

const SPEEDS = [30, 120, 600] as const;

export function MatchReplay({
  data,
  timeline,
  factions,
  length,
  cap = 100,
}: {
  data: ReplayData;
  timeline: number[][];
  factions: { name: string; color: string }[];
  /** the round's length in seconds */
  length: number;
  cap?: number;
}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(120);
  const last = useRef<number | null>(null);
  const at = useRef(0);
  const seek = (v: number) => {
    at.current = v;
    setT(v);
  };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const step = (now: number) => {
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      at.current = Math.min(length, at.current + dt * speed);
      setT(at.current);
      if (at.current >= length) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      last.current = null;
    };
  }, [playing, speed, length]);

  const turns = useMemo(() => turningPoints(timeline, factions.length), [timeline, factions.length]);
  const scores = scoreAt(timeline, factions.length, t);
  const n = killsBefore(data.kills, t);
  const board = useMemo(() => standings(data, n).slice(0, 5), [data, n]);
  const recent = data.kills.slice(Math.max(0, n - 6), n).reverse();
  const colorOf = (faction: string | null) => factions.find((f) => f.name === faction)?.color ?? 'var(--dim)';
  const firstBlood = data.kills.find((k) => k[1] >= 0 && !(k[4] & (TEAM_KILL | SUICIDE)));
  const toggle = () => {
    if (!playing && t >= length) seek(0);
    setPlaying((p) => !p);
  };

  const person = (i: number) => data.people[i];
  const name = (i: number) => {
    const p = person(i);
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="inline-block size-2 shrink-0" style={{ background: colorOf(p.faction) }} />
        {p.steamId ? (
          <Link prefetch={false} href={`/players/${p.steamId}`} className="link truncate">
            {p.name}
          </Link>
        ) : (
          <span className="truncate text-muted">{p.name}</span>
        )}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-9 items-center justify-center border border-accent bg-accent text-accent-ink transition-opacity hover:opacity-90"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="currentColor">
            {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4 2.5v11l9-5.5z" />}
          </svg>
        </button>
        <span className="num font-display text-2xl leading-none font-bold">
          {clock(t)}
          <span className="text-base text-dim"> / {clock(length)}</span>
        </span>
        <div role="group" aria-label="Speed" className="ml-auto inline-flex border border-line-strong bg-surface">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
              className={cx(
                'num px-2.5 py-1 font-display text-[12px] font-semibold transition-colors',
                speed === s ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-3 hover:text-text',
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-5 pt-3">
        {/* Turning points sit over the track: each a mark in the colour of the side that took the lead. */}
        {turns.map((p) => (
          <button
            key={p.t}
            type="button"
            onClick={() => seek(p.t)}
            title={`${clock(p.t)} · ${factions[p.faction].name} ${p.kind === 'retake' ? 'back in front' : 'takes the lead'}`}
            className="absolute top-0 size-2.5 -translate-x-1/2 rotate-45 border border-bg"
            style={{ left: `${(p.t / Math.max(1, length)) * 100}%`, background: factions[p.faction].color }}
          >
            <span className="sr-only">
              Jump to {clock(p.t)}: {factions[p.faction].name} {p.kind === 'retake' ? 'back in front' : 'takes the lead'}
            </span>
          </button>
        ))}
        <input
          type="range"
          min={0}
          max={length}
          step={1}
          value={Math.round(t)}
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
          aria-label="Time into the round"
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section>
          <h3 className="eyebrow mb-3 !text-[0.66rem]">Score</h3>
          <ul className="space-y-3">
            {factions.map((f, i) => (
              <li key={f.name}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-display font-semibold uppercase tracking-[0.06em]">{f.name}</span>
                  <span className="num font-semibold">{scores[i]}</span>
                </div>
                <div className="h-2 bg-surface-3">
                  <div className="h-full transition-[width] duration-150" style={{ width: `${Math.min(100, (scores[i] / cap) * 100)}%`, background: f.color }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="num mt-3 text-xs text-muted">{n} kills so far</p>
        </section>

        <section>
          <h3 className="eyebrow mb-3 flex !text-[0.66rem]">
            <span className="flex-1">Top players so far</span>
            <span className="w-6 text-right">K</span>
            <span className="w-8 text-right">D</span>
          </h3>
          {board.length ? (
            <ol className="space-y-1.5 text-sm">
              {board.map((s, i) => (
                <li key={s.person} className="flex items-center gap-2">
                  <span className="num w-4 text-dim">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {name(s.person)}
                  </span>
                  <span className="num w-6 text-right font-semibold">{s.kills}</span>
                  <span className="num w-8 text-right text-dim">{s.deaths}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No kills yet.</p>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-3 !text-[0.66rem]">Latest kills</h3>
          {recent.length ? (
            <ul className="space-y-1.5 text-sm">
              {recent.map((k, i) => (
                <li key={`${k[0]}-${i}`} className="flex items-center gap-2">
                  <span className="num w-12 shrink-0 text-[11px] text-dim">{clock(k[0])}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">
                    {k[1] >= 0 && k[1] !== k[2] ? name(k[1]) : null}
                    <span className="text-[11px] text-dim">
                      {k[4] & SUICIDE ? 'suicide' : k[3] >= 0 ? causeLabel(data.causes[k[3]]) : 'killed'}
                      {k[4] & HEADSHOT ? ' · HS' : ''}
                      {k[4] & TEAM_KILL ? ' · team kill' : ''}
                    </span>
                    {name(k[2])}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No kills yet.</p>
          )}
        </section>
      </div>

      {(turns.length > 0 || firstBlood) && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <span className="eyebrow mr-1 self-center !text-[0.66rem]">Jump to</span>
          {firstBlood && (
            <button type="button" onClick={() => seek(firstBlood[0])} className="border border-line-strong px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-text">
              <span className="num text-dim">{clock(firstBlood[0])}</span> First blood
            </button>
          )}
          {turns.map((p) => (
            <button
              key={p.t}
              type="button"
              onClick={() => seek(p.t)}
              className="flex items-center gap-1.5 border border-line-strong px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-text"
            >
              <span className="inline-block size-2" style={{ background: factions[p.faction].color }} />
              <span className="num text-dim">{clock(p.t)}</span>
              {factions[p.faction].name} {p.kind === 'retake' ? 'back in front' : 'takes the lead'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
