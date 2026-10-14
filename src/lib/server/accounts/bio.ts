// Bios are public text written by members, so they are checked when saved: one paragraph, at
// most BIO_MAX characters, no links, invites or mass pings, and none of the words staff list in
// DATA_DIR/blocked-words.txt (one per line; read on every save, so edits apply at once). Staff
// can still clear any bio on /admin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIO_MAX } from '@/lib/profile-themes';

export type BioProblem = 'long' | 'link' | 'ping' | 'word';
export type BioCheck = { ok: true; bio: string | null } | { ok: false; problem: BioProblem };

export const BIO_PROBLEMS: Record<BioProblem, string> = {
  long: `Keep your bio to ${BIO_MAX} characters.`,
  link: "Links and invites can't go in a bio.",
  ping: "Bios can't ping people.",
  word: "That bio has a word that isn't allowed. Please reword it.",
};

const LINK = /(https?:\/\/|www\.|discord(?:app)?\.(?:gg|com)\/|\b[a-z0-9-]+\.(?:com|net|org|gg|io|co|uk|ru|xyz|tv|me|link|app|dev)\b)/i;
const PING = /@(everyone|here)\b|<@[!&]?\d+>/i;
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b' };

/** Lower case, accents and look-alike characters folded, everything else that isn't a letter a space. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0134578!@$]/g, (c) => LOOKALIKE[c] ?? c)
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** The staff list, folded; missing file = no words. */
export function loadBlockedWords(dataDir: string): string[] {
  try {
    return readFileSync(join(dataDir, 'blocked-words.txt'), 'utf8')
      .split(/\r?\n/)
      .map((w) => fold(w).replace(/ /g, ''))
      .filter((w) => w.length >= 2);
  } catch {
    return [];
  }
}

function hasBlocked(text: string, blocked: string[]): boolean {
  if (!blocked.length) return false;
  const folded = fold(text);
  const words = new Set(folded.split(' '));
  const squashed = folded.replace(/ /g, '');
  // Whole words always; longer ones also when spaced or run together ("b a d", "xbadx").
  return blocked.some((w) => words.has(w) || (w.length >= 5 && squashed.includes(w)));
}

/** A cleaned bio to save (null = cleared), or why it can't be saved. */
export function checkBio(raw: string, blocked: string[]): BioCheck {
  const bio = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!bio) return { ok: true, bio: null };
  if ([...bio].length > BIO_MAX) return { ok: false, problem: 'long' };
  if (LINK.test(bio)) return { ok: false, problem: 'link' };
  if (PING.test(bio)) return { ok: false, problem: 'ping' };
  if (hasBlocked(bio, blocked)) return { ok: false, problem: 'word' };
  return { ok: true, bio };
}
