// Clan tags from in-game names: "[TEG] Sam", "Sam (NOR)", "{DPB}Bob". Client-safe.

const OPEN = '[({<';
const CLOSE = '])}>';
/** A bracketed tag at the start or end of a name. */
const LEADING = /^\s*([[({<])\s*([A-Za-z0-9]{2,6})\s*([\])}>])/;
const TRAILING = /([[({<])\s*([A-Za-z0-9]{2,6})\s*([\])}>])\s*$/;

const pairs = (open: string, close: string) => OPEN.indexOf(open) === CLOSE.indexOf(close);

/** The clan tag in a name, upper-cased ("TEG"), or null. Needs a letter: "[1]" or "(2024)" isn't a clan. */
export function clanTag(name: string): string | null {
  for (const re of [LEADING, TRAILING]) {
    const m = re.exec(name);
    if (m && pairs(m[1], m[3]) && /[A-Za-z]/.test(m[2])) return m[2].toUpperCase();
  }
  return null;
}

/** The clan page address: /clans/teg. */
export const clanSlug = (tag: string) => tag.toLowerCase();

/** A clan page's slug back to its tag; null for anything that couldn't be one. */
export function parseClanSlug(slug: string): string | null {
  return /^[a-z0-9]{2,6}$/i.test(slug) && /[a-z]/i.test(slug) ? slug.toUpperCase() : null;
}
