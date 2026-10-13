import Link from 'next/link';
import { int, kd } from '@/lib/format';
import { mapName } from '@/lib/game';
import type { PlayerMatchRow } from '@/lib/server/views';
import { cx, Panel } from './ui';

const RESULT = {
  win: { letter: 'W', bar: 'bg-good', text: 'text-good', word: 'Win' },
  loss: { letter: 'L', bar: 'bg-bad', text: 'text-bad', word: 'Loss' },
  draw: { letter: 'D', bar: 'bg-muted', text: 'text-muted', word: 'Draw' },
  none: { letter: '–', bar: 'bg-dim', text: 'text-dim', word: 'No result' },
} as const;

/** The last rounds at a glance: kills per round as bars, coloured by result, oldest on the left. */
export function RecentForm({ rounds, streak }: { rounds: PlayerMatchRow[]; streak: { kind: 'win' | 'loss'; n: number } | null }) {
  if (!rounds.length) return null;
  const ordered = [...rounds].reverse();
  const most = Math.max(1, ...ordered.map((r) => r.kills));
  const kills = ordered.reduce((n, r) => n + r.kills, 0);
  const deaths = ordered.reduce((n, r) => n + r.deaths, 0);
  const count = (k: 'win' | 'loss' | 'draw') => ordered.filter((r) => r.result === k).length;
  return (
    <Panel title="Recent form" action={`Last ${ordered.length} round${ordered.length === 1 ? '' : 's'}`}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="num font-display text-lg font-bold text-good">{count('win')}W</span>{' '}
          <span className="num font-display text-lg font-bold text-bad">{count('loss')}L</span>
          {count('draw') > 0 && <span className="num font-display text-lg font-bold text-muted"> {count('draw')}D</span>}
        </span>
        <span className="text-muted">
          <span className="num font-semibold text-text">{kd(kills, deaths)}</span> K/D
        </span>
        <span className="text-muted">
          <span className="num font-semibold text-text">{(kills / ordered.length).toFixed(1)}</span> kills a round
        </span>
        {streak && streak.n > 1 && (
          <span className={streak.kind === 'win' ? 'text-good' : 'text-bad'}>
            {streak.n} {streak.kind === 'win' ? 'wins' : 'losses'} in a row
          </span>
        )}
      </div>
      <ol className="mt-4 flex h-28 items-end gap-1.5" aria-label="Kills per round, oldest first">
        {ordered.map((r) => {
          const res = RESULT[r.result ?? 'none'];
          const label = `${mapName(r.map)} · ${int(r.kills)} kills, ${int(r.deaths)} deaths · ${res.word}`;
          return (
            <li key={`${r.serverId}-${r.matchId}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <Link
                prefetch={false}
                href={`/matches/${r.serverId}/${r.matchId}`}
                title={label}
                aria-label={label}
                className="flex w-full flex-1 items-end transition-opacity hover:opacity-80"
              >
                <span className={cx('block w-full', res.bar)} style={{ height: `${Math.max(4, (r.kills / most) * 100)}%` }} />
              </Link>
              <span className={cx('font-display text-[11px] font-bold', res.text)}>{res.letter}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
