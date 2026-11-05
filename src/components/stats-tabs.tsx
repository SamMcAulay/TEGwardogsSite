import { Pill } from './ui';

const STATS = [
  { key: 'leaderboards', label: 'Leaderboards', href: '/leaderboards' },
  { key: 'skill', label: 'Skill', href: '/skill' },
  { key: 'records', label: 'Records', href: '/records' },
  { key: 'clans', label: 'Clans', href: '/clans' },
] as const;

/** The Stats home's own tabs, shown on each of its pages. */
export function StatsTabs({ current }: { current: (typeof STATS)[number]['key'] }) {
  return (
    <nav aria-label="Stats" className="mb-4 flex flex-wrap gap-2">
      {STATS.map((s) => (
        <Pill key={s.key} href={s.href} on={s.key === current}>
          {s.label}
        </Pill>
      ))}
    </nav>
  );
}
