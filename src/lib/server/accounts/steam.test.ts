import { describe, expect, test, vi } from 'vitest';
import { steamLoginUrl, verifySteamLogin } from './steam';

const RETURN = 'https://stats.example.com/auth/steam/callback?state=abc';
const ID = 'https://steamcommunity.com/openid/id/76561198000000001';

const reply = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': ID,
    'openid.identity': ID,
    'openid.return_to': RETURN,
    'openid.response_nonce': '2026-10-13T10:00:00Zxyz',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'sig=',
    ...over,
  });

const steamSays = (text: string) => vi.fn(async () => new Response(text)) as unknown as typeof fetch;

describe('steam openid', () => {
  test('login url asks Steam to pick the identity and come back to us', () => {
    const u = new URL(steamLoginUrl(RETURN, 'https://stats.example.com'));
    expect(u.origin + u.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(u.searchParams.get('openid.return_to')).toBe(RETURN);
    expect(u.searchParams.get('openid.realm')).toBe('https://stats.example.com');
    expect(u.searchParams.get('openid.mode')).toBe('checkid_setup');
  });

  test('returns the SteamID64 once Steam confirms the signature', async () => {
    const f = steamSays('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
    expect(await verifySteamLogin(reply(), RETURN, f)).toBe('76561198000000001');
    const body = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as URLSearchParams;
    expect(body.get('openid.mode')).toBe('check_authentication');
    expect(body.get('openid.sig')).toBe('sig=');
  });

  test('rejects when Steam says the signature is invalid', async () => {
    expect(await verifySteamLogin(reply(), RETURN, steamSays('is_valid:false\n'))).toBeNull();
  });

  test('rejects without asking Steam: wrong return_to, endpoint, id, or unsigned fields', async () => {
    const f = steamSays('is_valid:true\n');
    expect(await verifySteamLogin(reply({ 'openid.return_to': `${RETURN}x` }), RETURN, f)).toBeNull();
    expect(await verifySteamLogin(reply({ 'openid.op_endpoint': 'https://evil.example/openid/login' }), RETURN, f)).toBeNull();
    const other = 'https://evil.example/openid/id/76561198000000001';
    expect(await verifySteamLogin(reply({ 'openid.claimed_id': other, 'openid.identity': other }), RETURN, f)).toBeNull();
    expect(await verifySteamLogin(reply({ 'openid.signed': 'op_endpoint,claimed_id,identity' }), RETURN, f)).toBeNull();
    expect(await verifySteamLogin(reply({ 'openid.mode': 'cancel' }), RETURN, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
