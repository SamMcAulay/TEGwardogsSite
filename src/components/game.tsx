import Link from 'next/link';
import { contours } from '@/lib/topo';
import { ago, clock, metres } from '@/lib/format';
import { causeInfo, factionColor, lightingName, mapName, REGION_NAMES, type RotationStop, rotationView } from '@/lib/game';
import type { FactionScore, KillRow, ServerRow, ServerStatus } from '@/lib/server/views';

import { PlayerName } from './tier';
import { cx, StatusDot } from './ui';

const nowSec = () => Math.floor(Date.now() / 1000);

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
  cap,
  compact,
}: {
  scores: FactionScore[];
  /** points that fill the bar; without one, the leading score does */
  cap?: number | null;
  compact?: boolean;
}) {
  const lead = Math.max(...scores.map((s) => s.score));
  const full = cap ?? Math.max(lead, 1);
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
                width: `${Math.min(100, (f.score / full) * 100)}%`,
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

export const statusLabel = (online: boolean | null) =>
  online === null ? 'Status unavailable' : online ? 'Online' : 'Offline';

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
          <span className="eyebrow !text-[0.66rem] !text-text">{statusLabel(server.online)}</span>
        </div>
        <div className="absolute top-3 right-4 eyebrow !text-[0.66rem]">
          {REGION_NAMES[server.region] ?? server.region}
        </div>
        <div className="absolute bottom-3 left-4">
          <div className="display text-2xl leading-none text-text">{server.shortName}</div>
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
            <FactionScores scores={st.factionScores} cap={st.scoreCap} compact />
          </>
        ) : (
          <div className="py-5 text-center text-sm text-muted">
            {server.online === null
              ? 'Status unavailable right now'
              : server.updatedAt
                ? `Last seen ${ago(server.updatedAt)}`
                : 'Waiting for first contact'}
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
      <Link prefetch={false} href={`/players/${id}`} className={cx('link truncate font-medium', cls)}>
        {/* A teamkiller's name stays red. */}
        {cls ? name : <PlayerName steamId={id} name={name} tag={false} />}
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

type Weather = 'rain' | 'dawn' | 'clear';

const weatherOf = (lighting: string | null): Weather =>
  lighting && /rain/i.test(lighting) ? 'rain' : lighting && /start/i.test(lighting) ? 'dawn' : 'clear';

function WeatherIcon({ weather }: { weather: Weather }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
      {weather === 'rain' ? (
        <path d="M4.5 9.5a3 3 0 0 1 .4-6 4 4 0 0 1 7.4 1.2A2.5 2.5 0 0 1 12 9.5zM5.5 12l-1 2M8.5 12l-1 2M11.5 12l-1 2" strokeLinejoin="round" />
      ) : weather === 'dawn' ? (
        <path d="M1.5 12.5h13M4.5 12.5a3.5 3.5 0 0 1 7 0M8 3.5V6M3.4 6.4l1.2 1.2M12.6 6.4l-1.2 1.2" />
      ) : (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </>
      )}
    </svg>
  );
}

const STOP_LABEL = { prev: 'Previous', now: 'Now playing', next: 'Up next' } as const;

function RotationCard({ stop, role }: { stop: RotationStop | null; role: keyof typeof STOP_LABEL }) {
  const weather = weatherOf(stop?.lighting ?? null);
  const now = role === 'now';
  return (
    <div className={cx('min-w-0 border bg-surface-2', now ? 'border-accent' : 'border-line', role === 'prev' && 'opacity-60')}>
      {/* Banner: the map's contours over its time of day; rain gets streaks. */}
      <div className={cx('relative aspect-[4/3] overflow-hidden sm:aspect-[16/7]', `sky-${weather}`)}>
        {stop && <MapBackdrop map={stop.map} className="text-text/60" />}
        {weather === 'rain' && <div className="rain absolute inset-0" />}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-2 via-surface-2/30 to-transparent" />
        <span
          className={cx(
            'absolute top-2 left-2 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.12em]',
            now ? 'bg-accent text-accent-ink' : 'bg-bg/80 text-muted',
          )}
        >
          {STOP_LABEL[role]}
        </span>
        {stop?.slot != null && (
          <span className="num absolute top-2 right-2 font-mono text-[10px] text-muted">#{stop.slot + 1}</span>
        )}
      </div>
      <div className="px-2.5 pt-1 pb-2.5 sm:px-3">
        <div className={cx('display truncate leading-tight', now ? 'text-lg sm:text-2xl' : 'text-sm sm:text-lg')}>
          {stop ? mapName(stop.map) : '—'}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted sm:text-xs">
          {stop ? (
            <>
              <WeatherIcon weather={weather} />
              <span className="truncate">{lightingName(stop.lighting) || 'Day'}</span>
              {now && stop.slot == null && <span className="truncate text-accent">· off rotation</span>}
            </>
          ) : (
            <span>Off rotation</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Previous, current and next map, with where the server is in the rotation. */
export function MapRotation({ status }: { status: ServerStatus }) {
  const view = rotationView(status);
  if (!view) return null;
  const { prev, now, next, length } = view;
  return (
    <div>
      <div className="grid grid-cols-[1fr_1.35fr_1fr] items-end gap-2 sm:gap-3">
        <RotationCard stop={prev} role="prev" />
        <RotationCard stop={now} role="now" />
        <RotationCard stop={next} role="next" />
      </div>
      <ol className="mt-4 flex gap-1" aria-label="Rotation">
        {Array.from({ length }, (_, i) => (
          <li
            key={i}
            title={`#${i + 1}${i === now.slot ? ' · now playing' : i === next?.slot ? ' · up next' : ''}`}
            className={cx(
              'h-1 flex-1',
              i === now.slot ? 'bg-accent' : i === next?.slot ? 'bg-accent/40' : 'bg-line-strong',
            )}
          >
            <span className="sr-only">
              Map {i + 1}
              {i === now.slot ? ', now playing' : i === next?.slot ? ', up next' : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
