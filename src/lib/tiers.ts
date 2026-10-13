// Priority tiers from Discord roles. 1 is the front of the queue. Client-safe.

export type Tier = 1 | 2 | 3;

export const TIERS: Record<Tier, { label: string; who: string }> = {
  1: { label: 'Admin', who: 'Moderators and WARDOGS staff' },
  2: { label: 'Premium', who: 'Premium Discord members' },
  3: { label: 'Verified', who: 'Verified Discord members' },
};

export interface TierRoles {
  staff: string[];
  premium: string[];
  verified: string[];
}

/** The best tier any of the member's roles grants, or null when none do. */
export function tierFor(roles: readonly string[], cfg: TierRoles): Tier | null {
  const has = (ids: string[]) => ids.some((id) => roles.includes(id));
  if (has(cfg.staff)) return 1;
  if (has(cfg.premium)) return 2;
  if (has(cfg.verified)) return 3;
  return null;
}
