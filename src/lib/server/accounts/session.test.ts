import { describe, expect, test } from 'vitest';
import { readSession, signSession } from './session';

const secret = 's'.repeat(32);
const session = { discordId: '111111111111111111', name: 'Jan', exp: 2000 };

describe('session cookie', () => {
  test('round-trips while unexpired', () => {
    expect(readSession(signSession(session, secret), secret, 1000)).toEqual(session);
  });

  test('rejects expired, tampered, re-signed with another secret, or junk', () => {
    const token = signSession(session, secret);
    expect(readSession(token, secret, 2000)).toBeNull();
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ d: '222222222222222222', n: 'Jan', e: 2000 })).toString('base64url');
    expect(readSession(`${forged}.${sig}`, secret, 1000)).toBeNull();
    expect(readSession(signSession(session, 'o'.repeat(32)), secret, 1000)).toBeNull();
    expect(readSession('nonsense', secret, 1000)).toBeNull();
    expect(readSession(undefined, secret, 1000)).toBeNull();
  });
});
