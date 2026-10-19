// Light or dark: chosen once on a visitor's first visit, kept in a cookie so the server renders the
// right one with no flash. Client-safe.

export type Theme = 'dark' | 'light';

export const THEME_COOKIE = 'theme';

/** A cookie value as a theme; null means the visitor hasn't picked yet. */
export const parseTheme = (v: string | undefined): Theme | null => (v === 'dark' || v === 'light' ? v : null);

/** The browser chrome colour (mobile address bar) for each theme: its --bg token. */
export const THEME_CHROME: Record<Theme, string> = { dark: '#07090c', light: '#f3f4f6' };
