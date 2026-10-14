// Custom profiles: who may customise, the colour palette, and the limits. Client-safe.
// The palette is hex here, not CSS tokens, because the Discord card (next/og) draws with it too.
import type { CSSProperties } from 'react';
import type { Tier } from './tiers';

/** Premium members and staff customise their profiles; it shows only while they hold that tier. */
export const canCustomise = (tier: Tier | null | undefined): tier is 1 | 2 => tier === 1 || tier === 2;

export const BIO_MAX = 160;
export const FEATURED_MAX = 3;

/** Hand-picked to read well on the dark site and the card. */
export const PROFILE_COLOURS = {
  ember: { label: 'Ember', hex: '#f76b15' },
  gold: { label: 'Gold', hex: '#f2b33d' },
  lime: { label: 'Lime', hex: '#9be15d' },
  emerald: { label: 'Emerald', hex: '#2fbf71' },
  teal: { label: 'Teal', hex: '#12a594' },
  sky: { label: 'Sky', hex: '#3ba7f5' },
  cobalt: { label: 'Cobalt', hex: '#5b6cff' },
  violet: { label: 'Violet', hex: '#9b5de5' },
  orchid: { label: 'Orchid', hex: '#d24fbf' },
  rose: { label: 'Rose', hex: '#f0507a' },
  sand: { label: 'Sand', hex: '#c9ae7c' },
  steel: { label: 'Steel', hex: '#8b98a9' },
} as const;

export type ProfileColour = keyof typeof PROFILE_COLOURS;

export const isProfileColour = (v: unknown): v is ProfileColour => typeof v === 'string' && Object.hasOwn(PROFILE_COLOURS, v);

/** What a customised profile shows. */
export interface ProfileCustom {
  bio: string | null;
  colour: ProfileColour | null;
  /** milestone track keys, at most FEATURED_MAX */
  featured: string[];
}

/**
 * The site's accent tokens (globals.css) re-pointed at a profile colour, for a wrapper around that
 * profile page: stat highlights, meters, badges, link hovers and accent buttons take the colour.
 * Every palette colour is bright enough for the site's dark accent ink on it.
 */
export function profileThemeStyle(hex: string): CSSProperties {
  return {
    '--accent': hex,
    '--accent-soft': `color-mix(in srgb, ${hex} 12%, transparent)`,
    '--accent-ink': '#0b0d10',
    '--line-strong': `color-mix(in srgb, ${hex} 28%, #29313c)`,
  } as CSSProperties;
}
