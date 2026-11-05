import { Pill } from './ui';

const SECTIONS = {
  live: [
    { key: 'home', label: 'Now', href: '/' },
    { key: 'servers', label: 'Servers', href: '/servers' },
    { key: 'matches', label: 'Matches', href: '/matches' },
    { key: 'feed', label: 'Kill feed', href: '/feed' },
  ],
  stats: [
    { key: 'leaderboards', label: 'Leaderboards', href: '/leaderboards' },
    { key: 'skill', label: 'Skill', href: '/skill' },
    { key: 'records', label: 'Records', href: '/records' },
    { key: 'clans', label: 'Clans', href: '/clans' },
  ],
} as const;

type Section = keyof typeof SECTIONS;

/** A home's own pages as a row of pills (Live: Now · Servers · Matches · Kill feed; Stats: …). */
export function SectionTabs<S extends Section>({ section, current }: { section: S; current: (typeof SECTIONS)[S][number]['key'] }) {
  return (
    <nav aria-label={section === 'live' ? 'Live' : 'Stats'} className="flex flex-wrap gap-2">
      {SECTIONS[section].map((s) => (
        <Pill key={s.key} href={s.href} on={s.key === current}>
          {s.label}
        </Pill>
      ))}
    </nav>
  );
}
