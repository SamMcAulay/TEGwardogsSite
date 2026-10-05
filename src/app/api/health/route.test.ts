import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/server/warcon/env', () => ({
  siteEnv: () => {
    throw new Error('SITE_URL must be an absolute http(s) URL, got: secret-value');
  },
}));

describe('GET /api/health', () => {
  test('503 on invalid config without leaking configured values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('./route');
    const res = await GET();
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'config' });
    expect(text).not.toContain('secret-value');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
