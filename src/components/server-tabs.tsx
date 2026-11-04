'use client';

import Link from 'next/link';
import { useState } from 'react';
import { duration, int } from '@/lib/format';
import { factionColor, lightingName, mapArt } from '@/lib/game';
import { keepOpen, isLive, killerLine, roundHeadline, type TabServer } from '@/lib/live';
import { RankCell, cx } from './ui';

type Friends = Record<string, { steamId: string; name: string }[]>;

const who = (names: string[]) =>
  names.length === 1 ? `${names[0]} is here` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are here`;

function Tab({ s, open, onOpen, friends }: { s: TabServer; open: boolean; onOpen: () => void; friends: Friends[string] | undefined }) {
  const live = isLive(s);
  const art = s.map ? mapArt(s.map, s.lighting) : null;
  const line = s.online === false ? 'Offline' : s.online === null ? 'Status unavailable' : [s.map, lightingName(s.lighting), s.roundSeconds != null && `${duration(s.roundSeconds)} in`].filter(Boolean).join(' · ');
  return (
    <div className={cx('overflow-hidden rounded-[22px] border-[3px] border-edge bg-surface-2 shadow-[0_4px_0_var(--edge)]', open && 'outline-[3px] -outline-offset-1 outline-accent outline', !live && 'opacity-55')}>
      <button
        type="button"
        disabled={!live}
        aria-expanded={live ? open : undefined}
        onClick={onOpen}
        className="block w-full text-left disabled:cursor-default"
      >
        <div className={cx('relative overflow-hidden border-b-[3px] border-edge bg-surface-3 transition-[height] duration-300', open ? 'h-24' : 'h-14')}>
          {art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-bg/85 to-bg/25" />
          <span className="display absolute bottom-2 left-4 text-lg">{s.shortName}</span>
          <span className="num absolute right-3 bottom-2.5 rounded-full bg-black/60 px-2.5 text-sm font-extrabold">
            {s.online ? `${s.playerCount}/${s.maxPlayers ?? '—'}` : 'offline'}
          </span>
        </div>
        <div className="px-4 pt-2.5 pb-3">
          <div className="truncate text-sm font-semibold text-muted">{line || 'Waiting for the round'}</div>
          {live && (
            <div className="mt-2 flex gap-1" aria-label={s.scores.map((x) => `${x.name} ${x.score}`).join(', ')}>
              {s.scores.map((x) => (
                <span key={x.name} className="h-3 flex-1 overflow-hidden rounded-full border-2 border-edge bg-bg">
                  <span className="block h-full" style={{ width: `${Math.min(100, (x.score / s.cap) * 100)}%`, background: factionColor(x.name) }} />
                </span>
              ))}
            </div>
          )}
          {friends?.length ? <div className="mt-2 truncate text-sm font-bold text-good">{who(friends.map((f) => f.name))}</div> : null}
        </div>
      </button>
      {open && live && (
        <div className="px-4 pb-4">
          <p className="display text-lg leading-tight">{roundHeadline(s)}</p>
          {killerLine(s.topKillers[0]) && <p className="mt-1 text-sm text-muted">{killerLine(s.topKillers[0])}</p>}
          {s.topKillers.length > 0 && (
            <ol className="mt-3 grid gap-1.5">
              {s.topKillers.map((p, i) => (
                <li key={p.steamId || i} className="flex items-center gap-2.5 text-sm font-bold">
                  <RankCell rank={i + 1} faction={p.faction} />
                  {p.steamId ? (
                    <Link prefetch={false} href={`/players/${p.steamId}`} className="link min-w-0 flex-1 truncate">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  )}
                  <span className="num text-muted">{int(p.kills)} kills</span>
                </li>
              ))}
            </ol>
          )}
          <Link href={`/servers/${s.slug}`} className="pill mt-4 !py-1.5 text-sm">
            Server page →
          </Link>
        </div>
      )}
    </div>
  );
}

/** The Live page's floating card: one tab per server; the open one shows how its round is going. */
export function ServerTabs({ servers, friends, playing, up, total }: { servers: TabServer[]; friends: Friends; playing: number; up: number; total: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  // A refresh brings new props; the viewer's pick stays open while that server is live.
  const open = keepOpen(picked, servers);
  return (
    <aside className="panel flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="display text-xl">Servers</h2>
        <Link href="/servers" className="text-sm font-bold text-accent">
          <span className="num">{int(playing)}</span> playing · {up} of {total} up
        </Link>
      </div>
      {servers.map((s) => (
        <Tab key={s.id} s={s} open={open === s.id} onOpen={() => setPicked(s.id)} friends={friends[s.id]} />
      ))}
    </aside>
  );
}
