// Steam sign-in over OpenID 2.0: send the browser to Steam, then have Steam confirm the answer.
const OP = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';
const SELECT = `${NS}/identifier_select`;
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

type Fetch = typeof fetch;

export function steamLoginUrl(returnTo: string, realm: string): string {
  const q = new URLSearchParams({
    'openid.ns': NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': SELECT,
    'openid.claimed_id': SELECT,
  });
  return `${OP}?${q}`;
}

/**
 * The SteamID64 Steam vouches for, or null. `expectedReturnTo` must be exactly the return_to this
 * site sent (it carries the state nonce), so a response minted for another site or browser fails.
 */
export async function verifySteamLogin(params: URLSearchParams, expectedReturnTo: string, f: Fetch = fetch): Promise<string | null> {
  if (params.get('openid.mode') !== 'id_res') return null;
  if (params.get('openid.op_endpoint') !== OP) return null;
  if (params.get('openid.return_to') !== expectedReturnTo) return null;
  const claimed = params.get('openid.claimed_id') ?? '';
  const match = CLAIMED.exec(claimed);
  if (!match || params.get('openid.identity') !== claimed) return null;
  // The signature covers these fields; Steam checks it for us.
  const signed = (params.get('openid.signed') ?? '').split(',');
  for (const field of ['op_endpoint', 'return_to', 'claimed_id', 'identity', 'response_nonce']) {
    if (!signed.includes(field)) return null;
  }

  const body = new URLSearchParams();
  for (const [k, v] of params) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  const res = await f(OP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  return /^is_valid:true$/m.test(text) ? match[1] : null;
}
