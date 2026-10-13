'use server';
// Server Actions: Next rejects cross-origin posts, so these can't be fired from another site.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accounts, currentSession } from '@/lib/server/accounts';
import { SESSION_COOKIE } from '@/lib/server/accounts/session';

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
