import Link from 'next/link';
import { contours } from '@/lib/topo';
import { ago, clock, metres } from '@/lib/format';
import { nowSec } from '@/lib/server/db';
import { causeInfo, factionColor, mapName, REGION_NAMES } from '@/lib/game';
import type { KillRow, ServerRow } from '@/lib/server/queries';
import type { FactionScore } from '@/lib/server/rcon';
import { cx, StatusDot } from './ui';

/** Contour-line terrain for a map, as a decorative backdrop. */
export function MapBackdrop({ map, className }: { map: string | null | undefined; className?: string }) {
  const paths = contours(map ?? 'none');
  return (
    <svg
      viewBox="0 0 64 36"
      preserveAspectRatio="xMidYMid slice"
      className={cx('pointer-events-none absolute inset-0 h-full w-full', className)}
      aria-hidden
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={i % 4 === 3 ? 0.09 : 0.045}
          strokeOpacity={i % 4 === 3 ? 0.5 : 0.28}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function FactionScores({
  scores,
  cap = 100,
  compact,
}: {
  scores: FactionScore[];
  cap?: number;
  compact?: boolean;
}) {
  const lead = Math.max(...scores.map((s) => s.score));
  return (
    <div className={cx('grid', compact ? 'gap-1.5' : 'gap-3')}>
      {scores.map((f) => (
        <div key={f.name} className="grid grid-cols-[88px_1fr_36px] items-center gap-3">
          <span
            className={cx(
              'truncate font-display text-[12px] font-semibold uppercase tracking-[0.1em]',
              f.score === lead && lead > 0 ? 'text-text' : 'text-muted',
            )}
          >
            {f.name}
          </span>
          <div className={cx('relative bg-surface-3', compact ? 'h-1.5' : 'h-2.5')}>
            <div
              className="absolute inset-y-0 left-0 transition-[width] duration-700"
              style={{
                width: `${Math.min(100, (f.score / cap) * 100)}%`,
                background: factionColor(f.name, f.colorHex),
              }}
            />
          </div>
          <span className="num text-right font-display text-sm font-bold">{f.score}</span>
        </div>
      ))}
    </div>
  );
}

export function ServerCard({ server }: { server: ServerRow }) {
  const st = server.status;
  const pop = server.playerCount;
  const max = st?.players.max ?? 0;
  const fill = max ? pop / max : 0;
  return (
    <Link
      href={`/servers/${server.id}`}
      className="group panel relative block overflow-hidden transition-colors hover:border-line-strong"
    >
      <div className="relative h-28 overflow-hidden border-b border-line bg-surface-2 text-accent/60">
        <MapBackdrop map={st?.map} className={server.online ? '' : 'opacity-30 grayscale'} />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-2 via-surface-2/40 to-transparent" />
        <div className="absolute top-3 left-4 flex items-center gap-2">
          <StatusDot online={server.online} />
          <span className="eyebrow !text-[0.66rem] !text-text">{server.online ? 'Online' : 'Offline'}</span>
        </div>
        <div className="absolute top-3 right-4 eyebrow !text-[0.66rem]">
          {REGION_NAMES[server.region] ?? server.region}
        </div>
        <div className="absolute bottom-3 left-4">
          <div className="display text-2xl leading-none text-text">{server.shortName}</div>
          <div className="mt-1 text-xs text-muted">{server.location}</div>
        </div>
        <div className="absolute right-4 bottom-3 text-right">
          <div className="display num text-2xl leading-none text-text">
            {server.online ? pop : '—'}
            <span className="text-base text-dim">/{max || '—'}</span>
          </div>
          <div className="mt-1 text-xs text-muted">players</div>
        </div>
      </div>
      <div className="h-0.5 bg-surface-3">
        <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${fill * 100}%` }} />
      </div>
      <div className="px-4 py-3.5">
        {st ? (
          <>
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-text">
                {mapName(st.map)}
              </span>
              <span className="text-muted">
                King of the Hill{st.matchSeconds != null && <span className="num"> · {clock(st.matchSeconds)}</span>}
              </span>
            </div>
            <FactionScores scores={st.factionScores} compact />
          </>
        ) : (
          <div className="py-5 text-center text-sm text-muted">
            {server.lastOnlineAt ? `Last seen ${ago(server.lastOnlineAt)}` : 'Waiting for first contact'}
          </div>
        )}
      </div>
    </Link>
  );
}

const TAG_LABEL: Record<string, string> = {
  Headshot: 'HS',
  Penetration: 'WALL',
  Ricochet: 'RICO',
  WeaponMelee: 'MELEE',
  VehicleExplosion: 'VEH',
  RoadKill: 'ROAD',
  Falling: 'FALL',
};

export function KillTags({ tags }: { tags: string }) {
  const list = tags ? tags.split(',').filter((t) => TAG_LABEL[t]) : [];
  if (!list.length) return null;
  return (
    <>
      {list.map((t) => (
        <span
          key={t}
          className={cx(
            'border px-1 font-display text-[10px] font-bold tracking-[0.08em]',
            t === 'Headshot' ? 'border-accent/50 text-accent' : 'border-line-strong text-muted',
          )}
        >
          {TAG_LABEL[t]}
        </span>
      ))}
    </>
  );
}

/** One kill feed line: killer, weapon, victim, distance. */
export function KillLine({ k, showServer, now }: { k: KillRow; showServer?: boolean; now?: number }) {
  const weapon = causeInfo(k.cause);
  const who = (id: string | null, name: string | null, cls?: string) =>
    id && name ? (
      <Link href={`/players/${id}`} className={cx('link truncate font-medium', cls)}>
        {name}
      </Link>
    ) : (
      <span className="truncate text-muted">{name ?? 'World'}</span>
    );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,160px)_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-2 sm:justify-end">
        {k.suicide
          ? who(k.victimSteamId, k.victimName)
          : who(k.killerSteamId, k.killerName, k.teamkill ? 'text-bad' : '')}
        <span className="text-dim sm:hidden">›</span>
        <span className="min-w-0 truncate sm:hidden">{k.suicide ? null : who(k.victimSteamId, k.victimName)}</span>
      </div>
      <div className="hidden min-w-0 items-center justify-center gap-1.5 sm:flex">
        <span className="truncate border border-line bg-surface-2 px-2 py-0.5 text-center text-xs text-muted">
          {k.suicide ? 'Suicide' : weapon.label}
        </span>
        <KillTags tags={k.tags} />
      </div>
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        {k.suicide ? <span className="text-dim">—</span> : who(k.victimSteamId, k.victimName)}
        {k.teamkill ? <span className="font-display text-[10px] font-bold tracking-[0.08em] text-bad">TK</span> : null}
      </div>
      <div className="flex items-center justify-end gap-3 text-xs text-dim">
        {k.distance != null && !k.suicide && <span className="num hidden md:inline">{metres(k.distance)}</span>}
        {showServer && <span className="hidden lg:inline">{k.serverName}</span>}
        <span className="num w-14 text-right">{ago(k.ts, now)}</span>
      </div>
    </div>
  );
}

export function KillList({ kills, showServer }: { kills: KillRow[]; showServer?: boolean }) {
  const now = nowSec();
  return (
    <div className="divide-y divide-line">
      {kills.map((k) => (
        <KillLine key={k.eventId} k={k} showServer={showServer} now={now} />
      ))}
    </div>
  );
}
