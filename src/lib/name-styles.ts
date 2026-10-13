// How a linked member's name is drawn. Each tier has a style; staff can give an account its own
// style on /admin, which shows only while that member holds a TEG tier. Client-safe.
import type { Tier } from './tiers';

export const NAME_STYLES = ['aurora', 'gold', 'pearl', 'pink'] as const;
export type NameStyle = (typeof NAME_STYLES)[number];

export const NAME_STYLE_LABELS: Record<NameStyle, string> = {
  aurora: 'Aurora (staff)',
  gold: 'Gold (Premium)',
  pearl: 'Pearl blue (Verified)',
  pink: 'Pink',
};

export const TIER_STYLE: Record<Tier, NameStyle> = { 1: 'aurora', 2: 'gold', 3: 'pearl' };

export const isNameStyle = (v: unknown): v is NameStyle => typeof v === 'string' && (NAME_STYLES as readonly string[]).includes(v);

/** The style a name is drawn in: the account's own while they hold a tier, else the tier's; none untiered. */
export function nameStyleFor(tier: Tier | null, own: string | null | undefined): NameStyle | null {
  if (!tier) return null;
  return isNameStyle(own) ? own : TIER_STYLE[tier];
}
