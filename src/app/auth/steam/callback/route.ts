import type { NextRequest } from 'next/server';
import { accounts, callbackUrl, currentSession } from '@/lib/server/accounts';
import { authError, clearState, redirectTo } from '@/lib/server/accounts/routes';
import { safeEqual, STATE_COOKIE } from '@/lib/server/accounts/session';
import { verifySteamLogin } from '@/lib/server/accounts/steam';
import { SteamTakenError } from '@/lib/server/accounts/store';
import { refreshTier } from '@/lib/server/accounts/sync';

export const dynamic = 'force-dynamic';

/** Steam sends the browser back here; Steam confirms who signed in, then the accounts are linked. */
export async function GET(req: NextRequest) {
  const a = accounts();
  if (!a) return authError('off');
  const session = await currentSession(a);
  if (!session) return clearState(authError('signin'));
  const q = req.nextUrl.searchParams;
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  const state = q.get('state');
  if (!state || !expected || !safeEqual(state, expected)) return clearState(authError('state'));

  let steamId;
  try {
    steamId = await verifySteamLogin(q, `${callbackUrl('steam')}?state=${expected}`);
  } catch (e) {
    console.error('[auth] steam check failed:', e instanceof Error ? e.message : e);
  }
  if (!steamId) return clearState(authError('steam'));

  try {
    a.store.link(session.discordId, steamId);
  } catch (e) {
    if (e instanceof SteamTakenError) return clearState(authError('taken'));
    throw e;
  }
  await refreshTier(a.env, a.store, session.discordId).catch((e) => console.error('[auth] tier refresh failed:', e instanceof Error ? e.message : e));
  return clearState(redirectTo('/account', { linked: '1' }));
}
