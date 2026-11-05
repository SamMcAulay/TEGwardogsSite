// The site's four homes (Live, Stats, Players, You) and which one a page belongs to. Client-safe.

export type TabKey = 'live' | 'stats' | 'players' | 'you';

export const TABS: { key: Exclude<TabKey, 'you'>; label: string; href: string }[] = [
  { key: 'live', label: 'Live', href: '/' },
  { key: 'stats', label: 'Stats', href: '/leaderboards' },
  { key: 'players', label: 'Players', href: '/players' },
];

const SECTIONS: [TabKey, string[]][] = [
  ['live', ['/servers', '/feed', '/matches']],
  ['stats', ['/leaderboards', '/skill', '/records', '/clans']],
  ['players', ['/players', '/compare']],
  ['you', ['/account', '/friends']],
];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function activeTab(pathname: string): TabKey | null {
  if (pathname === '/') return 'live';
  return SECTIONS.find(([, bases]) => bases.some((b) => under(pathname, b)))?.[0] ?? null;
}

/** The You menu's links; signing out is a form, not a link. */
export function youItems(me: { steamId: string | null } | null): { label: string; href: string }[] {
  if (!me) return [{ label: 'Sign in', href: '/account' }];
  if (!me.steamId)
    return [
      { label: 'Account settings', href: '/account' },
      { label: 'Friends', href: '/friends' },
    ];
  return [
    { label: 'My profile', href: `/players/${me.steamId}` },
    { label: 'Friends', href: '/friends' },
    { label: 'Account settings', href: '/account' },
  ];
}

/** An open menu closes on Escape, or on a press anywhere outside it (including its own toggle). */
export function dismisses(e: { type: string; key?: string }, inside: boolean): boolean {
  return e.type === 'keydown' ? e.key === 'Escape' : !inside;
}
