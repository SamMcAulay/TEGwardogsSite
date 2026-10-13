// Shared bits of the /auth/* route handlers.
import { NextResponse } from 'next/server';
import { siteEnv } from '@/lib/server/warcon/env';
import { secureCookies } from '.';
import { STATE_COOKIE, STATE_TTL } from './session';

/** Problems /account knows how to explain */
export type AuthError = 'off' | 'state' | 'discord' | 'signin' | 'steam' | 'taken';

/** Redirect to a page of this site; built from SITE_URL, never the request's Host. */
export function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const url = new URL(path, siteEnv().siteUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export const authError = (error: AuthError) => redirectTo('/account', { error });

export function withState(res: NextResponse, state: string): NextResponse {
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/auth', maxAge: STATE_TTL });
  return res;
}

export const clearState = (res: NextResponse) => {
  res.cookies.set(STATE_COOKIE, '', { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/auth', maxAge: 0 });
  return res;
};
