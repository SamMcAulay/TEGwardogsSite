import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAvatar } from './og-render';

const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchAvatar', () => {
  test("fetches Steam's avatar CDN and returns a data URI", async () => {
    const f = vi.fn(async () => jpeg());
    vi.stubGlobal('fetch', f);
    expect(await fetchAvatar('https://avatars.steamstatic.com/a_medium.jpg')).toMatch(/^data:image\/jpeg;base64,/);
  });

  test('never fetches anything but https on Steam’s own image hosts', async () => {
    const f = vi.fn(async () => jpeg());
    vi.stubGlobal('fetch', f);
    for (const url of [
      'http://avatars.steamstatic.com/a.jpg',
      'https://someone-else.akamaihd.net/a.jpg',
      'https://steamstatic.com.evil.example/a.jpg',
      'https://127.0.0.1/a.jpg',
      'not a url',
    ]) {
      expect(await fetchAvatar(url)).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });

  test('refuses redirects, so an allowed host cannot send the request elsewhere', async () => {
    const f = vi.fn<(u: URL, init?: RequestInit) => Promise<Response>>(async () => {
      throw new TypeError('redirect');
    });
    vi.stubGlobal('fetch', f);
    expect(await fetchAvatar('https://avatars.steamstatic.com/a.jpg')).toBeNull();
    expect(f.mock.calls[0][1]?.redirect).toBe('error');
  });
});
