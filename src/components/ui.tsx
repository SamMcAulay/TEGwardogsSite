import Link from 'next/link';
import type { ReactNode } from 'react';
import { BAND_TONE, bandLabel, bandOf, closeness } from '@/lib/balance';
import { factionColor, KOTH_CAP, rankColour } from '@/lib/game';

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
  return <div className={cx('mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
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
      <Container className="pt-8 pb-4 sm:pt-10">
        {tabs && <div className="mb-6">{tabs}</div>}
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-3 flex items-center gap-2">{eyebrow}</div>}
            <h1 className="display text-4xl sm:text-5xl">{title}</h1>
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
    <section className={cx('panel min-w-0 overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
          <h2 className="display text-xl text-text">{title}</h2>
          {action && <div className="text-sm text-muted">{action}</div>}
        </div>
      )}
      <div className={flush ? 'pb-2' : 'px-6 pt-1 pb-6'}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-bold whitespace-nowrap text-accent transition-opacity hover:opacity-80">
      {children} →
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
    <div className="min-w-0 px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className={cx('display num mt-2 truncate text-[30px]', accent && 'text-accent')}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-sm text-muted">{sub}</div>}
    </div>
  );
}

/** Stat tiles in one chunky card, split by dashed lines. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('panel grid divide-x-2 divide-dashed divide-line', className)}>{children}</div>;
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
    accent: 'bg-accent text-on-fill',
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
        'inline-flex items-center gap-1.5 rounded-full border-2 border-edge px-2.5 py-0.5 text-xs font-extrabold whitespace-nowrap',
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
      <span className="inline-block size-2.5 rounded-full border-2 border-edge" style={{ background: factionColor(name) }} />
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
    <nav aria-label={label} className="inline-flex flex-wrap gap-2">
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

/** A fat rounded bar, for share-of-total columns. */
export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  const w = meterWidth(value, max);
  return (
    <div className="h-4 w-full overflow-hidden rounded-full border-[3px] border-edge bg-bg">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color ?? 'var(--accent)' }} />
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
      <div className="edge h-7 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full border-r-[3px] border-edge" style={{ width: `${w}%`, background: color ?? factionColor(name) }} />
      </div>
    </div>
  );
}

/** A round's final scores as small faction-coloured tags, highest first. */
export function ScoreChips({ scores }: { scores: { name: string; score: number }[] }) {
  return (
    <span className="inline-flex gap-1">
      {[...scores]
        .sort((a, b) => b.score - a.score)
        .map((s) => (
          <span
            key={s.name}
            title={s.name}
            className="num rounded-lg border-2 border-edge px-1.5 text-xs font-extrabold text-on-fill"
            style={{ background: factionColor(s.name) }}
          >
            {s.score}
          </span>
        ))}
    </span>
  );
}

/** Fair / One-sided / Landslide for a finished round; nothing when it can't be told. */
export function ClosenessChip({ scores }: { scores: number[] }) {
  const c = closeness(scores);
  if (c === null) return null;
  const band = bandOf(c);
  return <Badge tone={BAND_TONE[band]}>{bandLabel(band)}</Badge>;
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

/** A chunky rank badge: gold, silver, bronze, then the player's faction (or plain when unknown). */
export function RankCell({ rank, faction, large }: { rank: number; faction?: string | null; large?: boolean }) {
  const filled = rank <= 3 || !!faction;
  return (
    <span
      className={cx(
        'display num inline-flex shrink-0 items-center justify-center border-[3px] border-edge',
        large ? 'size-11 rounded-[14px] text-base shadow-[0_3px_0_var(--edge)]' : 'size-8 rounded-[10px] text-xs',
        filled ? 'text-on-fill' : 'bg-surface-2 text-muted',
      )}
      style={filled ? { background: rankColour(rank, faction) } : undefined}
    >
      {rank}
    </span>
  );
}
