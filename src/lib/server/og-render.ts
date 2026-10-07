// Turns a card (JSX) into a PNG with next/og, using the site's own fonts from public/fonts.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReactElement } from 'react';
import { ImageResponse } from 'next/og';

export const CARD_SIZE = { width: 1200, height: 630 } as const;

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: 'normal' };

const FONTS: [name: string, file: string, weight: Font['weight']][] = [
  ['Inter', 'inter-latin-400-normal.woff', 400],
  ['Inter', 'inter-latin-ext-400-normal.woff', 400],
  ['Inter', 'inter-cyrillic-400-normal.woff', 400],
  ['Inter', 'inter-latin-600-normal.woff', 600],
  ['Inter', 'inter-latin-ext-600-normal.woff', 600],
  ['Inter', 'inter-cyrillic-600-normal.woff', 600],
  ['Barlow', 'barlow-condensed-latin-700-normal.woff', 700],
  ['Mono', 'jetbrains-mono-latin-500-normal.woff', 500],
];

let fonts: Promise<Font[]> | null = null;
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    FONTS.map(async ([name, file, weight]) => {
      const buf = await readFile(path.join(process.cwd(), 'public', 'fonts', file));
      return { name, weight, style: 'normal' as const, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    }),
  ).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

export async function renderPng(element: ReactElement): Promise<ArrayBuffer> {
  const res = new ImageResponse(element, { ...CARD_SIZE, fonts: await loadFonts() });
  return res.arrayBuffer();
}

/** Steam's avatar CDNs: any *.steamstatic.com, and its one legacy Akamai host (not all of akamaihd.net). */
const AVATAR_HOST = /^([a-z0-9-]+\.)+steamstatic\.com$|^steamcdn-a\.akamaihd\.net$/;

/**
 * A Steam avatar as a data URI, or null (the card then shows initials). Only Steam's image hosts
 * are fetched, redirects are refused (so an allowed host can't point the request anywhere else),
 * and a short timeout keeps a slow CDN from holding up the card.
 */
export async function fetchAvatar(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !AVATAR_HOST.test(u.hostname)) return null;
    const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > 500_000) return null;
    return `data:${type.split(';')[0]};base64,${body.toString('base64')}`;
  } catch {
    return null;
  }
}
