import Link from 'next/link';
import { Avatar } from './avatar';
import { PlayerName } from './tier';
import { cx } from './ui';

export { Avatar };

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
      <PlayerName steamId={steamId} name={name} className="font-medium" />
    </Link>
  );
}
