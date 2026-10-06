import Link from 'next/link';
import type { ReactNode } from 'react';
import { factionColor } from '@/lib/game';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1280px] px-4 sm:px-6', className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="grid-bg border-b border-line">
      <Container className="py-10 sm:py-12">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-3 flex items-center gap-2">{eyebrow}</div>}
            <h1 className="display text-4xl leading-none sm:text-5xl">{title}</h1>
            {description && <p className="mt-3 max-w-2xl text-[15px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </Container>
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding: for tables and lists that run edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className={cx('panel min-w-0', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="display text-[15px] tracking-[0.06em] text-text">{title}</h2>
          {action && <div className="text-xs text-muted">{action}</div>}
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="eyebrow !text-[0.66rem] transition-colors hover:!text-accent">
      {children} →
    </Link>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-surface px-4 py-4">
      <div className="eyebrow !text-[0.66rem]">{label}</div>
      <div className={cx('display num mt-1.5 truncate text-[28px] leading-none', accent && 'text-accent')}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Stat tiles on a hairline grid. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid gap-px border border-line bg-line', className)}>{children}</div>;
}

/** online null: status unknown (Warcon didn't answer), drawn as a hollow ring. */
export function StatusDot({ online, className }: { online: boolean | null; className?: string }) {
  return (
    <span
      className={cx(
        'inline-block size-2 shrink-0 rounded-full',
        online === null ? 'border border-dim' : online ? 'live-dot bg-good' : 'bg-dim',
        className,
      )}
      aria-label={online === null ? 'Status unavailable' : online ? 'Online' : 'Offline'}
    />
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'good' | 'bad';
}) {
  const tones = {
    default: 'border-line-strong text-muted',
    accent: 'border-accent/40 bg-accent-soft text-accent',
    good: 'border-good/40 bg-good/10 text-good',
    bad: 'border-bad/40 bg-bad/10 text-bad',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.1em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function FactionTag({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-dim">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className="inline-block size-2" style={{ background: factionColor(name) }} />
      {name}
    </span>
  );
}

/** Links that set one query parameter, rendered as a segmented control. */
export function Segmented({
  items,
  active,
  label,
}: {
  items: { key: string; label: ReactNode; href: string }[];
  active: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="inline-flex border border-line-strong bg-surface">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          scroll={false}
          aria-current={it.key === active ? 'page' : undefined}
          className={cx(
            'px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors',
            it.key === active ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-3 hover:text-text',
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const btn = 'border border-line-strong px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.1em]';
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 text-sm text-muted">
      <span className="num">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={cx(btn, 'hover:border-accent hover:text-accent')} href={href(page - 1)}>
            ← Prev
          </Link>
        ) : (
          <span className={cx(btn, 'opacity-40')}>← Prev</span>
        )}
        {page < pages ? (
          <Link className={cx(btn, 'hover:border-accent hover:text-accent')} href={href(page + 1)}>
            Next →
          </Link>
        ) : (
          <span className={cx(btn, 'opacity-40')}>Next →</span>
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

/** A thin proportional bar, for share-of-total columns. */
/** Bar width in %: at least a sliver, never wider than the track. */
export function meterWidth(value: number, max: number): number {
  return max > 0 ? Math.min(100, Math.max(1.5, (value / max) * 100)) : 0;
}

export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  const w = meterWidth(value, max);
  return (
    <div className="h-1 w-full overflow-hidden bg-surface-3">
      <div className="h-full" style={{ width: `${w}%`, background: color ?? 'var(--accent)' }} />
    </div>
  );
}

export function RankCell({ rank }: { rank: number }) {
  return (
    <span
      className={cx(
        'num inline-flex h-6 min-w-6 items-center justify-center px-1 font-display text-[13px] font-bold',
        rank === 1 && 'bg-accent text-accent-ink',
        rank === 2 && 'bg-[#c9ced6] text-[#111]',
        rank === 3 && 'bg-[#b07a4a] text-[#111]',
        rank > 3 && 'text-dim',
      )}
    >
      {rank}
    </span>
  );
}
