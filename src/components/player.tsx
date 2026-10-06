import Link from 'next/link';
import { cx } from './ui';

/** Stable hue from a string, so a player's badge keeps its colour everywhere. */
function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(name: string): string {
  const clean = name
    .replace(/\[[^\]]*\]\s*/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim();
  const parts = clean.split(/\s+|(?=[A-Z][a-z])/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2) || '?';
  return letters.toUpperCase();
}

export function Avatar({
  name,
  steamId,
  url,
  size = 28,
  className,
}: {
  name: string;
  steamId: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  if (url) {
    // Steam CDN avatars; plain img keeps next/image remote config out of self-hosted setups.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className={cx('shrink-0 bg-surface-3', className)} />;
  }
  const h = hue(steamId);
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center font-display font-bold', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${h} 28% 18%)`,
        color: `hsl(${h} 55% 72%)`,
        boxShadow: `inset 0 0 0 1px hsl(${h} 30% 28%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function PlayerLink({
  steamId,
  name,
  avatarUrl,
  avatar = true,
  className,
}: {
  steamId: string | null;
  name: string | null;
  avatarUrl?: string | null;
  avatar?: boolean;
  className?: string;
}) {
  if (!steamId || !name) return <span className="text-muted">{name ?? 'Unknown'}</span>;
  return (
    <Link prefetch={false} href={`/players/${steamId}`} className={cx('link inline-flex min-w-0 items-center gap-2.5', className)}>
      {avatar && <Avatar name={name} steamId={steamId} url={avatarUrl} size={24} />}
      <span className="truncate font-medium">{name}</span>
    </Link>
  );
}
