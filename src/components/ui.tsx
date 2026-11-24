import Link from 'next/link';
import type { ReactNode } from 'react';
import { factionColor, KOTH_CAP } from '@/lib/game';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const BUTTONS = {
  primary: 'pill pill-on',
  secondary: 'pill',
  danger: 'pill !bg-bad !text-on-fill',
};

/** Classes for a button-styled <button> or <a>. */
export const buttonClass = (kind: keyof typeof BUTTONS = 'secondary') => BUTTONS[kind];

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1480px] px-4 md:px-[clamp(16px,2.4vw,32px)]', className)}>{children}</div>;
}

export function PageHeader({
  tabs,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  /** the home's own pages (SectionTabs), above the title */
  tabs?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header>
      <Container className="pt-6 pb-4 sm:pt-8">
        {tabs && <div className="mb-6">{tabs}</div>}
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-3 flex items-center gap-2">{eyebrow}</div>}
            <h1 className="display text-5xl uppercase sm:text-7xl">{title}</h1>
            {description && <p className="mt-3 max-w-2xl text-base text-muted">{description}</p>}
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
    <section className={cx('flex min-w-0 flex-col', className)}>
      {(title || action) && (
        <div className="bc-gh flex-wrap">
          <h2>{title}</h2>
          {action && <div className="text-sm font-bold text-muted">{action}</div>}
        </div>
      )}
      <div className={cx('panel relative min-w-0 flex-1 overflow-hidden', flush ? 'pb-2' : 'px-6 pt-5 pb-6')}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-bold whitespace-nowrap text-muted transition-colors hover:text-text">
      {children}
    </Link>
  );
}

/** A pill-shaped link; `on` fills it with the accent. */
export function Pill({
  href,
  on,
  children,
  prefetch,
  className,
}: {
  href: string;
  on?: boolean;
  children: ReactNode;
  prefetch?: false;
  className?: string;
}) {
  return (
    <Link href={href} prefetch={prefetch} aria-current={on ? 'page' : undefined} className={cx('pill', on && 'pill-on', className)}>
      {children}
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
    <div className="bc-plate min-w-0 px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className={cx('display num mt-2 truncate text-[34px]', accent && 'text-accent')}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-sm text-muted">{sub}</div>}
    </div>
  );
}

/** Stat tiles: one plate each, two pixels apart. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid gap-0.5', className)}>{children}</div>;
}

/** online null: status unknown (Warcon didn't answer), drawn as a hollow ring. */
export function StatusDot({ online, className }: { online: boolean | null; className?: string }) {
  return (
    <span
      className={cx(
        'inline-block size-2.5 shrink-0 rounded-full',
        online === null ? 'border-2 border-dim' : online ? 'live-dot bg-good' : 'bg-dim',
        className,
      )}
      aria-label={online === null ? 'Status unavailable' : online ? 'Online' : 'Offline'}
    />
  );
}

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'accent' | 'good' | 'bad' | 'admin' | 'premium' | 'verified' | 'lonestar';
}) {
  const tones = {
    default: 'bg-surface-2 text-text',
    accent: 'bg-onair text-white',
    good: 'bg-good text-on-fill',
    bad: 'bg-bad text-on-fill',
    admin: 'bg-text text-on-fill',
    premium: 'bg-premium text-on-fill',
    verified: 'bg-verified text-on-fill',
    lonestar: 'bg-lonestar text-on-fill',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-extrabold tracking-wide whitespace-nowrap uppercase [font-stretch:85%]',
        tones[tone],
        className,
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
      <span className="inline-block size-2.5" style={{ background: factionColor(name) }} />
      {name}
    </span>
  );
}

/** Links that set one query parameter, rendered as a row of pills. */
export function Segmented({
  items,
  active,
  label,
  prefetch,
}: {
  items: { key: string; label: ReactNode; href: string }[];
  active: string;
  label?: string;
  /** false: don't pre-load the targets (heavy pages) */
  prefetch?: false;
}) {
  return (
    <nav aria-label={label} className="inline-flex flex-wrap gap-0.5">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          scroll={false}
          prefetch={prefetch}
          aria-current={it.key === active ? 'page' : undefined}
          className={cx('pill', it.key === active && 'pill-on')}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 text-sm text-muted">
      <span className="num">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="pill" href={href(page - 1)}>
            ← Prev
          </Link>
        ) : (
          <span className="pill opacity-40">← Prev</span>
        )}
        {page < pages ? (
          <Link className="pill" href={href(page + 1)}>
            Next →
          </Link>
        ) : (
          <span className="pill opacity-40">Next →</span>
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

/** Bar width in %: at least a sliver, never wider than the track. */
export function meterWidth(value: number, max: number): number {
  return max > 0 ? Math.min(100, Math.max(1.5, (value / max) * 100)) : 0;
}

/** A flat bar, for share-of-total columns. */
export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  const w = meterWidth(value, max);
  return (
    <div className="h-2.5 w-full overflow-hidden bg-surface-3">
      <div className="h-full" style={{ width: `${w}%`, background: color ?? 'var(--onair)' }} />
    </div>
  );
}

/** One team's race to the winning score: name, big score, a track filled to score/cap. */
export function RaceLane({ name, score, cap = KOTH_CAP, color }: { name: string; score: number; cap?: number | null; color?: string }) {
  const w = Math.min(100, Math.max(0, (score / (cap || KOTH_CAP)) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 font-extrabold">
        <span className="truncate">{name}</span>
        <span className="display num text-2xl">{score}</span>
      </div>
      <div className="h-7 overflow-hidden bg-surface-3">
        <div className="h-full" style={{ width: `${w}%`, background: color ?? factionColor(name) }} />
      </div>
    </div>
  );
}

/** Places climbed (▲) or fallen (▼) since a past board; nothing when unchanged or unknown. */
export function RankMove({ moved, since }: { moved: number | null | undefined; since?: string }) {
  if (!moved) return null;
  const up = moved > 0;
  return (
    <span
      className={cx('num ml-1.5 text-xs font-extrabold', up ? 'text-good' : 'text-bad')}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(moved)} place${Math.abs(moved) === 1 ? '' : 's'}${since ? ` since ${since}` : ''}`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(moved)}
      <span className="sr-only">{up ? ' places up' : ' places down'}</span>
    </span>
  );
}

/** A timing-tower position: on-air red for the leader, the player's faction when known, else white. */
export function RankCell({ rank, faction, large }: { rank: number; faction?: string | null; large?: boolean }) {
  const lead = rank === 1;
  return (
    <span
      className={cx(
        'display num inline-flex shrink-0 items-center justify-center',
        large ? 'size-11 text-xl' : 'size-8 text-base',
        lead ? 'bg-onair text-white' : 'bg-white text-on-fill',
      )}
      style={!lead && faction ? { background: factionColor(faction) } : undefined}
    >
      {rank}
    </span>
  );
}
