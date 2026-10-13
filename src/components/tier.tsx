import type { ReactNode } from 'react';
import { tierOfSteam } from '@/lib/server/accounts';
import { TIERS, type Tier } from '@/lib/tiers';
import { Badge, cx } from './ui';

const TONE = { 1: 'admin', 2: 'premium', 3: 'verified' } as const;
/** Admins get only the tag; Premium and Verified names are coloured too. */
const NAME: Record<Tier, string | undefined> = { 1: undefined, 2: 'name-premium', 3: 'name-verified' };

/** `compact`: the small size that sits beside a name in lists and tables. */
export function TierBadge({ tier, compact }: { tier: Tier; compact?: boolean }) {
  return (
    <Badge tone={TONE[tier]} className={compact ? 'shrink-0 !px-1 !py-0 !text-[9px] !tracking-[0.08em]' : undefined}>
      {TIERS[tier].label}
    </Badge>
  );
}

export function NameTag({ tier, className, children }: { tier: Tier | null; className?: string; children: ReactNode }) {
  return <span className={cx(tier && NAME[tier], className)}>{children}</span>;
}

/** A player's name in their linked Discord tier's colours, followed by the tier's tag unless `tag` is false. */
export function PlayerName({ steamId, name, tag = true, className }: { steamId: string; name: ReactNode; tag?: boolean; className?: string }) {
  const tier = tierOfSteam(steamId);
  return (
    <>
      <NameTag tier={tier} className={cx('truncate', className)}>
        {name}
      </NameTag>
      {tag && tier && <TierBadge tier={tier} compact />}
    </>
  );
}
