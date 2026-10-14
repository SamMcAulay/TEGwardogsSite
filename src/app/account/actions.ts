'use server';
// Server Actions: Next rejects cross-origin posts, so these can't be fired from another site.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accounts, currentSession } from '@/lib/server/accounts';
import { checkBio, loadBlockedWords } from '@/lib/server/accounts/bio';
import { SESSION_COOKIE } from '@/lib/server/accounts/session';
import { TRACKS } from '@/lib/milestones';
import { canCustomise, FEATURED_MAX, isProfileColour } from '@/lib/profile-themes';

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/account');
}

export async function unlinkSteam() {
  const a = accounts();
  const session = a && (await currentSession(a));
  if (a && session) a.store.unlink(session.discordId);
  redirect('/account');
}

const TRACK_KEYS = new Set(TRACKS.map((t) => t.key));

/** Save the signed-in member's custom profile; only Premium members and staff may. */
export async function saveProfile(form: FormData) {
  const a = accounts();
  const session = a && (await currentSession(a));
  const link = a && session ? a.store.byDiscord(session.discordId) : null;
  if (!a || !session || !link || !canCustomise(link.tier)) redirect('/account?profile=not-allowed');
  const bio = checkBio(String(form.get('bio') ?? ''), loadBlockedWords(a.env.dataDir));
  if (!bio.ok) redirect(`/account?profile=${bio.problem}#customise`);
  const colour = String(form.get('colour') ?? '');
  const featured = [...new Set(form.getAll('featured').map(String))].filter((k) => TRACK_KEYS.has(k)).slice(0, FEATURED_MAX);
  a.store.setProfile(session.discordId, { bio: bio.bio, colour: isProfileColour(colour) ? colour : null, featured });
  redirect('/account?profile=saved#customise');
}
