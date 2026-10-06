import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createWarcon, WarconError } from './http';

const okSchema = z.object({ ok: z.literal(true), n: z.number() });
const res = (status: number, body: unknown, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

const client = (f: typeof fetch) => createWarcon({ baseUrl: 'http://w', token: 'tok', fetch: f, timeoutMs: 50 });

describe('createWarcon', () => {
  test('sends the bearer token and parses the body', async () => {
    const f = vi.fn(async () => res(200, { ok: true, n: 1 }));
    await expect(client(f).json('/api/x', okSchema)).resolves.toEqual({ ok: true, n: 1 });
    expect(f).toHaveBeenCalledWith('http://w/api/x', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer tok' }) }));
  });

  test.each([
    [401, 'rejected'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'http'],
  ] as const)('HTTP %i becomes kind %s', async (status, kind) => {
    const err = await client(async () => res(status, { ok: false })).json('/api/x', okSchema).catch((e) => e);
    expect(err).toBeInstanceOf(WarconError);
    expect(err).toMatchObject({ status, kind, endpoint: '/api/x' });
  });

  test('a body that fails its schema names the endpoint and the path', async () => {
    const err = await client(async () => res(200, { ok: true, n: 'one' })).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'schema', endpoint: '/api/x' });
    expect(String(err.message)).toMatch(/\/api\/x[\s\S]*n/);
  });

  test('a network failure is unreachable', async () => {
    const err = await client(async () => {
      throw new TypeError('fetch failed');
    }).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'unreachable', status: null });
  });

  test('a slow answer is a timeout', async () => {
    const slow: typeof fetch = (_u, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'TimeoutError'))));
    const err = await client(slow).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'timeout' });
  });

  test('a per-call time limit replaces the default for that call only', async () => {
    // answers after `ms`, unless the request's signal aborts first (as real fetch does)
    const after = (ms: number): typeof fetch => (_u, init) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(res(200, { ok: true, n: 1 })), ms);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('x', 'TimeoutError'));
        });
      });
    // default 50 ms (see client()); 80 ms is too slow by default but fine with 200 ms allowed
    await expect(client(after(80)).json('/api/x', okSchema)).rejects.toMatchObject({ kind: 'timeout' });
    await expect(client(after(80)).json('/api/x', okSchema, { timeoutMs: 200 })).resolves.toEqual({ ok: true, n: 1 });
  });

  test('a Cloudflare login page (HTML 200) is rejected, not parsed', async () => {
    const err = await client(async () => res(200, '<html>', 'text/html')).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'http' });
  });

  test('text() returns the raw body', async () => {
    await expect(client(async () => res(200, 'a,b\n1,2', 'text/csv')).text('/api/e')).resolves.toBe('a,b\n1,2');
  });

  test('malformed JSON body is caught and becomes schema error', async () => {
    const err = await client(async () => res(200, 'not json', 'application/json')).json('/api/x', okSchema).catch((e) => e);
    expect(err).toBeInstanceOf(WarconError);
    expect(err).toMatchObject({ kind: 'schema', endpoint: '/api/x' });
    expect(String(err.message)).toMatch(/\/api\/x[\s\S]*not valid JSON/);
  });

  test('timeout during body read is caught and becomes timeout error', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new DOMException('x', 'TimeoutError');
      },
    };
    const err = await client(async () => mockResponse as unknown as Response).json('/api/x', okSchema).catch((e) => e);
    expect(err).toBeInstanceOf(WarconError);
    expect(err).toMatchObject({ kind: 'timeout', endpoint: '/api/x' });
  });
});
