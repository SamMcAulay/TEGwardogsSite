import type { NextRequest } from 'next/server';
import { accounts, callbackUrl, secureCookies } from '@/lib/server/accounts';
import { signedInUser } from '@/lib/server/accounts/discord';
import { authError, clearState, redirectTo } from '@/lib/server/accounts/routes';
import { safeEqual, SESSION_COOKIE, SESSION_TTL, signSession, STATE_COOKIE } from '@/lib/server/accounts/session';
import { refreshTier } from '@/lib/server/accounts/sync';

export const dynamic = 'force-dynamic';

/** Discord sends the browser back here with a code to trade for who they are. */
export async function GET(req: NextRequest) {
  const a = accounts();
  if (!a) return authError('off');
  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  const state = q.get('state');
  const code = q.get('code');
  // Declined on Discord's screen, or a return this browser never started.
  if (!code || !state || !expected || !safeEqual(state, expected)) return clearState(authError(q.get('error') ? 'discord' : 'state'));

  let user;
  try {
    user = await signedInUser(a.env, code, callbackUrl('discord'));
  } catch (e) {
    console.error('[auth] discord sign-in failed:', e instanceof Error ? e.message : e);
    return clearState(authError('discord'));
  }
  // Already linked: bring their tier up to date now rather than at the next sweep.
  if (a.store.byDiscord(user.id)) {
    await refreshTier(a.env, a.store, user.id).catch((e) => console.error('[auth] tier refresh failed:', e instanceof Error ? e.message : e));
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const res = clearState(redirectTo('/account'));
  res.cookies.set(SESSION_COOKIE, signSession({ discordId: user.id, name: user.name, exp }, a.env.sessionSecret), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
  return res;
}
