// The picture Discord (and other chat apps) show for a player link: /players/<id>/card.png.
// Drawn from the same cached profile the page uses, then kept for an hour per player.
import type { Metadata } from 'next';
import { ago, duration, int, kd } from '@/lib/format';
import { PlayerCardImage, SiteCardImage } from '@/components/og-card';
import { getPlayer, shortNameOf } from './data';
import { fetchAvatar, renderPng } from './og-render';
import { TtlCache } from './warcon/cache';
import type { PlayerProfile } from './views';

export interface CardModel {
  name: string;
  steamId: string;
  avatarUrl: string | null;
  /** e.g. "#1,580 all-time"; null when there's no rank to show */
  rank: string | null;
  seen: string;
  stats: { label: string; value: string }[];
}

export function cardModel(p: PlayerProfile, now = Date.now() / 1000): CardModel {
  const t = p.totals;
  const main = [...p.servers].sort((a, b) => b.playtime - a.playtime)[0];
  const seen = p.onlineOn ? `Playing now on ${shortNameOf(p.onlineOn.serverName)}` : `Last seen ${ago(p.lastSeen, now)}`;
  return {
    name: p.name,
    steamId: p.steamId,
    avatarUrl: p.avatarUrl,
    rank: typeof p.rank === 'number' ? `#${int(p.rank)} all-time` : null,
    seen: main ? `${seen} · mostly ${shortNameOf(main.name)}` : seen,
    stats: [
      { label: 'Kills', value: int(t.kills) },
      { label: 'K/D', value: kd(t.kills, t.deaths) },
      { label: 'Kills / hr', value: t.playtime ? ((t.kills * 3600) / t.playtime).toFixed(1) : '—' },
      { label: 'Playtime', value: duration(t.playtime) },
      { label: 'Win rate', value: t.matches ? `${Math.round((t.wins / t.matches) * 100)}%` : '—' },
    ],
  };
}

/** The profile page's title, summary and preview tags (Open Graph for Discord, Twitter card). */
export function playerMetadata(p: PlayerProfile): Metadata {
  const t = p.totals;
  const description = `${int(t.kills)} kills · ${kd(t.kills, t.deaths)} K/D · ${duration(t.playtime)} played on TEG WARDOGS servers.`;
  const image = `/players/${p.steamId}/card.png`;
  return {
    title: p.name,
    description,
    openGraph: { type: 'profile', title: p.name, description, siteName: 'TEG WARDOGS', images: [{ url: image, width: 1200, height: 630, alt: `${p.name} on TEG WARDOGS` }] },
    twitter: { card: 'summary_large_image', title: p.name, description, images: [image] },
  };
}

export interface Card {
  png: ArrayBuffer;
  kind: 'player' | 'site';
  /** seconds a browser, Cloudflare or Discord may keep it */
  maxAge: number;
}

const HOUR = 3_600_000;

function siteHost(): string | null {
  try {
    return process.env.SITE_URL ? new URL(process.env.SITE_URL).host : null;
  } catch {
    return null;
  }
}

let cards = new TtlCache({ maxEntries: 200, staleMs: 0, backoffMs: 0 });
let site: Promise<ArrayBuffer> | null = null;

function siteCard(maxAge: number): Promise<Card> {
  site ??= renderPng(SiteCardImage({ host: siteHost() })).catch((e) => {
    site = null;
    throw e;
  });
  return site.then((png) => ({ png, kind: 'site' as const, maxAge }));
}

/** Never throws for a missing player or a Warcon failure: those get the plain site card. */
export async function playerCard(steamId: string): Promise<Card> {
  if (!/^\d{17}$/.test(steamId)) return siteCard(86_400);
  try {
    const { value } = await cards.get<ArrayBuffer | null>(steamId, HOUR, async () => {
      const loaded = await getPlayer(steamId);
      if (!loaded) return null;
      const model = cardModel(loaded.data);
      const avatar = model.avatarUrl ? await fetchAvatar(model.avatarUrl) : null;
      return renderPng(PlayerCardImage({ model, avatar }));
    });
    return value ? { png: value, kind: 'player', maxAge: 3600 } : siteCard(3600);
  } catch (e) {
    console.error('player card failed', steamId, e);
    return siteCard(60);
  }
}

/** Tests only. */
export function resetCards(): void {
  cards = new TtlCache({ maxEntries: 200, staleMs: 0, backoffMs: 0 });
  site = null;
}
