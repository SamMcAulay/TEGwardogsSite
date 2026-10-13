import { int } from '@/lib/format';
import { milestones, type MilestoneTotals } from '@/lib/milestones';
import { Badge, cx, Meter, Panel } from './ui';

/** A profile's milestone badges: the best earned on each track, and how far to the next. */
export function Milestones({ totals }: { totals: MilestoneTotals }) {
  const tracks = milestones(totals);
  const earned = tracks.reduce((n, m) => n + m.level, 0);
  const possible = tracks.reduce((n, m) => n + m.steps, 0);
  return (
    <Panel title="Milestones" action={`${earned} of ${possible} earned`} flush>
      <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
        {tracks.map((m) => (
          <li key={m.key} className="bg-surface px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="eyebrow !text-[0.66rem]">{m.label}</span>
              <span className="flex gap-1" aria-label={`${m.level} of ${m.steps} badges`}>
                {Array.from({ length: m.steps }, (_, i) => (
                  <span key={i} className={cx('size-1.5', i < m.level ? 'bg-accent' : 'bg-surface-3')} />
                ))}
              </span>
            </div>
            <div className="mt-2 min-h-6">
              {m.earned ? <Badge tone="accent">{m.earned}</Badge> : <span className="text-sm text-dim">No badge yet</span>}
            </div>
            {m.next ? (
              <div className="mt-2.5 space-y-1.5">
                <Meter value={m.value} max={m.next.at} />
                <div className="text-xs text-muted">
                  Next: {m.next.badge} · <span className="num">{int(m.next.at - m.value)}</span> to go
                </div>
              </div>
            ) : (
              <div className="mt-2.5 text-xs text-accent">Every badge earned</div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
