import { accounts, callbackUrl } from '@/lib/server/accounts';
import { authorizeUrl } from '@/lib/server/accounts/discord';
import { authError, withState } from '@/lib/server/accounts/routes';
import { newState } from '@/lib/server/accounts/session';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Start "Sign in with Discord". */
export function GET() {
  const a = accounts();
  if (!a) return authError('off');
  const state = newState();
  return withState(NextResponse.redirect(authorizeUrl(a.env, callbackUrl('discord'), state), 303), state);
}
