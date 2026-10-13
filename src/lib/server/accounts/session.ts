// Stateless signed session cookie: who is signed in with Discord. HMAC-SHA256 over the payload.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'teg_session';
/** Short-lived nonce tying an OAuth / OpenID return to the browser that started it */
export const STATE_COOKIE = 'teg_auth_state';
export const SESSION_TTL = 30 * 24 * 3600;
export const STATE_TTL = 10 * 60;

export interface Session {
  discordId: string;
  /** Discord display name, shown only to its owner on /account */
  name: string;
  /** unix seconds */
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signSession(s: Session, secret: string): string {
  const body = b64(JSON.stringify({ d: s.discordId, n: s.name, e: s.exp }));
  return `${body}.${mac(secret, body)}`;
}

export function readSession(token: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, mac(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.d !== 'string' || !/^\d{17,20}$/.test(p.d) || typeof p.n !== 'string' || typeof p.e !== 'number') return null;
    if (p.e <= nowSec) return null;
    return { discordId: p.d, name: p.n, exp: p.e };
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const newState = () => randomBytes(18).toString('base64url');
