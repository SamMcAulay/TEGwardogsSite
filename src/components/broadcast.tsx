// The Broadcast graphics (see the .bc-* styles in globals.css and the approved mockup in
// .impeccable/mocks/directions/bc-segments.html). Server components; the feed's director and the
// standings toggle are client components in broadcast-feed.tsx.
/* eslint-disable @next/next/no-img-element -- Steam avatars and map banners at fixed broadcast sizes */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { causeLabel, factionColor, lightingName, mapArt } from '@/lib/game';
import { int, metres } from '@/lib/format';
import type { RoundStory, Turn } from '@/lib/server/feed';
import type { KillRow, RecordShot } from '@/lib/server/views';
import { Avatar } from './avatar';
import { ClockAt } from './broadcast-feed';

/** A player's picture: their Steam avatar square, or initials when there isn't one. */
export function Pic({ name, steamId, url, size }: { name: string; steamId: string; url: string | null; size: number }) {
  return url ? <img src={url} alt="" width={size} height={size} /> : <Avatar name={name} steamId={steamId} url={null} size={size} />;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const leadLine = (t: Turn) => `${t.faction} ${t.kind === 'retake' ? 'take the lead back' : 'take the lead'}`;

/** Today's top dog: the lower third under the feed. */
export function LowerThird({ steamId, name, avatarUrl, kills }: { steamId: string; name: string; avatarUrl: string | null; kills: number }) {
  return (
    <Link prefetch={false} href={`/players/${steamId}`} className="bc-l3">
      <Pic name={name} steamId={steamId} url={avatarUrl} size={76} />
      <span className="bc-k">Top dog today</span>
      <span className="bc-nm">
        {name}
        <span className="num">{int(kills)} kills in 24 h</span>
      </span>
    </Link>
  );
}

/** The score race of one round: each faction's line to the cap, with the lead changes marked. */
export function RoundChart({ round, cap }: { round: RoundStory; cap: number }) {
  const W = 1000;
  const H = 240;
  const x = (t: number) => (round.length ? (t / round.length) * W : 0);
  const y = (v: number) => H - (Math.min(v, cap) / cap) * H;
  const scoreAt = (t: number, f: number) => {
    let v = 0;
    for (const r of round.timeline) {
      if (r[0] > t) break;
      v = r[f + 1] ?? 0;
    }
    return v;
  };
  // The last two changes of lead, so the labels don't pile up.
  const turns = round.turns.slice(-2);
  return (
    <svg className="bc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Score over the round so far on ${round.serverName}`}>
      <line x1="0" x2={W} y1="0" y2="0" stroke="#fff" strokeDasharray="4 6" opacity=".5" />
      <text x={W - 4} y="-6" textAnchor="end">
        {cap} TO WIN
      </text>
      {round.factions.map((f, i) => (
        <polyline
          key={f}
          points={[...round.timeline.map((r) => `${x(r[0])},${y(r[i + 1] ?? 0)}`), `${W},${y(round.scores.find((s) => s.name === f)?.score ?? 0)}`].join(' ')}
          fill="none"
          stroke={factionColor(f)}
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {turns.map((t) => {
        const fi = round.factions.indexOf(t.faction);
        const cy = y(scoreAt(t.t, fi));
        return (
          <g key={`${t.t}-${t.faction}`}>
            <circle cx={x(t.t)} cy={cy} r="7" fill="var(--onair)" />
            <text x={Math.min(x(t.t) + 10, W - 220)} y={cy > 40 ? cy - 12 : cy + 26}>
              {leadLine(t).toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function RoundSoFar({ round, cap, scores }: { round: RoundStory; cap: number; scores: { name: string; score: number }[] }) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  return (
    <>
      <span className="bc-k">
        {round.serverName} · {round.map} · {mmss(round.length)} played
      </span>
      <RoundChart round={{ ...round, scores }} cap={cap} />
      {sorted.length > 1 && (
        <div className="bc-line">
          {sorted[0].score === sorted[1].score
            ? `All square at ${sorted[0].score}`
            : `${sorted[0].name} lead by ${sorted[0].score - sorted[1].score} · ${Math.max(0, cap - sorted[0].score)} points from the win`}
        </div>
      )}
    </>
  );
}

export function LongestShot({ shot, today }: { shot: RecordShot; today: boolean }) {
  return (
    <>
      <span className="bc-k">{today ? 'Longest shot today' : 'Longest shot on record'}</span>
      <div className="bc-huge num">
        {int(Math.round(shot.distance))}
        <small>m</small>
      </div>
      <div className="bc-ruler" />
      <div className="bc-line">
        {shot.steamId ? (
          <Link prefetch={false} href={`/players/${shot.steamId}`}>
            {shot.name}
          </Link>
        ) : (
          shot.name
        )}{' '}
        <em>{causeLabel(shot.cause)} →</em> {shot.victim} <em>· {shot.serverName}</em>
      </div>
    </>
  );
}

export function LastResult({ round }: { round: RoundStory }) {
  const top = Math.max(...round.scores.map((s) => s.score));
  const sorted = [...round.scores].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const margin = sorted.length > 1 ? winner.score - sorted[1].score : 0;
  return (
    <>
      <span className="bc-k">
        Final · {round.map} · {round.serverName}
      </span>
      <div className="bc-res">
        {round.scores.map((s) => (
          <span key={s.name} className="num" data-win={s.score === top || undefined} style={s.score === top ? { background: factionColor(s.name) } : { color: factionColor(s.name) }}>
            {s.score}
            <small>{s.name.toUpperCase()}</small>
          </span>
        ))}
      </div>
      <div className="bc-line">{margin === 0 ? `A dead heat at ${winner.score}` : margin <= 5 ? `Photo finish: ${winner.name} held on by ${margin}` : `${winner.name} win by ${margin}`}</div>
      {round.turns.length > 0 && (
        <div className="bc-tps">
          {round.turns.slice(-3).map((t) => (
            <span key={`${t.t}-${t.faction}`}>
              <b className="num">{mmss(t.t)}</b>
              {leadLine(t)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function Milestone({ m }: { m: { steamId: string; name: string; avatarUrl: string | null; label: string; value: number; next: number; badge: string } }) {
  const left = m.next - m.value;
  return (
    <>
      <span className="bc-k">Milestone watch</span>
      <div className="bc-who">
        <Pic name={m.name} steamId={m.steamId} url={m.avatarUrl?.replace('_medium', '_full') ?? null} size={140} />
        <div>
          <div className="bc-huge num" style={{ fontSize: 'clamp(60px,8vw,120px)' }}>
            {int(left)}
          </div>
          <div className="bc-line">
            {m.label.toLowerCase()} from {m.badge}
          </div>
        </div>
      </div>
      <div className="bc-prog">
        <i style={{ width: `${Math.min(100, (m.value / m.next) * 100)}%` }} />
      </div>
      <div className="bc-line">
        <em>
          <Link prefetch={false} href={`/players/${m.steamId}`}>
            {m.name}
          </Link>{' '}
          · {int(m.value)} / {int(m.next)}
        </em>
      </div>
    </>
  );
}

export function FriendsOn({ friends }: { friends: { steamId: string; name: string; avatarUrl: string | null; serverName: string; serverSlug: string }[] }) {
  return (
    <>
      <span className="bc-k">
        {friends.length} of your friends {friends.length === 1 ? 'is' : 'are'} on
      </span>
      <div className="bc-friends">
        {friends.slice(0, 6).map((f) => (
          <Link key={f.steamId} prefetch={false} href={`/players/${f.steamId}`}>
            <Pic name={f.name} steamId={f.steamId} url={f.avatarUrl} size={56} />
            <span>
              <b>{f.name}</b>
              <small>{f.serverName}</small>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

/** The running order: what's on now and the next three maps on each server. */
export function RunningOrder({ servers }: { servers: { id: string; name: string; slug: string; now: { map: string; lighting: string | null } | null; next: { map: string; lighting: string | null; at: number | null }[] }[] }) {
  const art = (map: string, lighting: string | null) => {
    const src = mapArt(map, lighting);
    return src ? <img src={src} alt="" loading="lazy" /> : <span className="bc-noart" />;
  };
  return (
    <aside className="bc-rundown" aria-labelledby="bc-rd">
      <div className="bc-gh">
        <h2 id="bc-rd">Running order</h2>
        <Link href="/servers">Rotation</Link>
      </div>
      {servers.map((s) => (
        <div key={s.id} className="contents">
          <Link href={`/servers/${s.slug}`} className="bc-sep hover:text-white">
            {s.name} →
          </Link>
          {s.now && (
            <Link href={`/servers/${s.slug}`} className="bc-slot" data-now>
              <span className="bc-t">NOW</span>
              {art(s.now.map, s.now.lighting)}
              <span>
                <b>{s.now.map}</b>
                <small>{lightingName(s.now.lighting)}</small>
              </span>
            </Link>
          )}
          {s.next.map((m, i) => (
            <div key={`${m.map}-${m.lighting}-${i}`} className="bc-slot" data-later={i > 0 || undefined}>
              <span className="bc-t num">{m.at ? <ClockAt ts={m.at} /> : 'Later'}</span>
              {art(m.map, m.lighting)}
              <span>
                <b>{m.map}</b>
                <small>{lightingName(m.lighting)}</small>
              </span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

/** The kill feed ticker. It pauses on hover and focus, and stands still for reduced motion. */
export function Ticker({ kills, factionOf }: { kills: KillRow[]; factionOf: Record<string, string> }) {
  const sw = (id: string | null) => {
    const f = id ? factionOf[id] : undefined;
    return f ? <span className="bc-sw" style={{ background: factionColor(f) }} /> : null;
  };
  const shown = kills.filter((k) => !k.suicide);
  const items = (copy: string) =>
    shown.map((k) => (
      <span key={copy + k.eventId} role="listitem">
        {sw(k.killerSteamId)}
        {k.killerName ?? 'World'}
        <span className="bc-g">{causeLabel(k.cause)}</span>
        {sw(k.victimSteamId)}
        {k.victimName ?? 'Unknown'}
        {k.headshot ? <span className="bc-hs">HEADSHOT</span> : null}
        {k.distance != null && k.distance >= 300 ? <span className="bc-g">{metres(k.distance)}</span> : null}
      </span>
    ));
  return (
    <div className="bc-ticker">
      <Link href="/feed">KILL FEED</Link>
      {shown.length ? (
        <div className="bc-tape" role="list" aria-label="Latest kills">
          {items('a')}
          {/* a second copy so the loop joins up; hidden from screen readers */}
          <span aria-hidden className="contents">
            {items('b')}
          </span>
        </div>
      ) : (
        <div className="bc-tape" style={{ animation: 'none' }}>
          Quiet right now.
        </div>
      )}
    </div>
  );
}

export function Results({ rounds }: { rounds: { serverId: string; serverName: string; matchId: number; map: string; scores: { name: string; score: number }[] }[] }) {
  if (!rounds.length) return <p className="bc-empty">No finished rounds yet.</p>;
  return (
    <div>
      {rounds.map((r) => {
        const top = Math.max(...r.scores.map((s) => s.score));
        const sorted = r.scores.map((s) => s.score).sort((a, b) => b - a);
        return (
          <Link key={`${r.serverId}-${r.matchId}`} prefetch={false} href={`/matches/${r.serverId}/${r.matchId}`} className="bc-result bc-plate">
            <span>
              <b>{r.map}</b>
              <small>{r.serverName}</small>
            </span>
            <span className="bc-trio">
              {r.scores.map((s) => (
                <span key={s.name} className="num" data-win={s.score === top || undefined} style={s.score === top ? { background: factionColor(s.name) } : { color: factionColor(s.name) }}>
                  {s.score}
                </span>
              ))}
            </span>
            {sorted.length > 1 && sorted[0] - sorted[1] <= 5 && <span className="bc-photo">Photo finish</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** A short ranked list in the timing-tower style. */
export function Tower({ rows, empty }: { rows: { key: string; href?: string; name: string; pic?: ReactNode; value: ReactNode }[]; empty: string }) {
  if (!rows.length) return <p className="bc-empty">{empty}</p>;
  return (
    <div className="bc-tower">
      {rows.map((r, i) => {
        const inner = (
          <>
            <span className="bc-p num">{i + 1}</span>
            {r.pic}
            <span className="bc-n">{r.name}</span>
            <span className="bc-v num">{r.value}</span>
          </>
        );
        const cls = r.pic ? 'bc-pos' : 'bc-pos bc-noimg';
        return r.href ? (
          <Link key={r.key} prefetch={false} href={r.href} className={cls}>
            {inner}
          </Link>
        ) : (
          <div key={r.key} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export function Heading({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="bc-gh">
      <h2>{title}</h2>
      {href && <Link href={href}>{link}</Link>}
    </div>
  );
}

