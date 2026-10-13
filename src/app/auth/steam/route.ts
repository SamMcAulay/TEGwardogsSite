import { NextResponse } from 'next/server';
import { accounts, callbackUrl, currentSession } from '@/lib/server/accounts';
import { authError, withState } from '@/lib/server/accounts/routes';
import { newState } from '@/lib/server/accounts/session';
import { steamLoginUrl } from '@/lib/server/accounts/steam';
import { siteEnv } from '@/lib/server/warcon/env';

export const dynamic = 'force-dynamic';

/** Start "Link Steam"; needs a Discord sign-in first, since that's what the Steam account links to. */
export async function GET() {
  const a = accounts();
  if (!a) return authError('off');
  if (!(await currentSession(a))) return authError('signin');
  const state = newState();
  const returnTo = `${callbackUrl('steam')}?state=${state}`;
  return withState(NextResponse.redirect(steamLoginUrl(returnTo, siteEnv().siteUrl), 303), state);
}
