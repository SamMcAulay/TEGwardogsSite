import type { ReactNode } from 'react';
import { lookOfSteam } from '@/lib/server/accounts';
import type { NameStyle } from '@/lib/name-styles';
import { TIERS, type Tier } from '@/lib/tiers';
import { Badge, cx } from './ui';

const TONE = { 1: 'admin', 2: 'premium', 3: 'verified' } as const;
const NAME_CLASS: Record<NameStyle, string> = { aurora: 'name-aurora', gold: 'name-premium', pearl: 'name-verified', pink: 'name-pink' };

/** `compact`: the small size that sits beside a name in lists and tables. */
export function TierBadge({ tier, compact }: { tier: Tier; compact?: boolean }) {
  return (
    <Badge tone={TONE[tier]} className={compact ? 'shrink-0 !px-1 !py-0 !text-[9px] !tracking-[0.08em]' : undefined}>
      {TIERS[tier].label}
    </Badge>
  );
}

/** A name drawn in a style (see lib/name-styles.ts); plain when there is none. */
export function NameTag({ style, className, children }: { style: NameStyle | null; className?: string; children: ReactNode }) {
  return <span className={cx(style && NAME_CLASS[style], className)}>{children}</span>;
}

/** A player's name in their linked account's style, followed by their tier's tag unless `tag` is false. */
export function PlayerName({ steamId, name, tag = true, className }: { steamId: string; name: ReactNode; tag?: boolean; className?: string }) {
  const look = lookOfSteam(steamId);
  return (
    <>
      <NameTag style={look?.nameStyle ?? null} className={cx('truncate', className)}>
        {name}
      </NameTag>
      {tag && look && <TierBadge tier={look.tier} compact />}
    </>
  );
}
