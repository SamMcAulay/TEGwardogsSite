import { describe, expect, it } from 'vitest';
import type { Store } from '../accounts/store';
import { runSlotSync, slotSyncConfig, SLOT_GROUP, syncSlotGroup } from './slots';

/** A fake Warcon slot-groups API holding one org's groups, recording every call. */
function fakeWarcon(groups: { id: string; name: string; on: boolean; entries: string[] }[], failAdd?: string) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://w/api/orgs/org1/slot-groups', '');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    if (path === '' && method === 'GET') return json({ ok: true, groups });
    if (path === '' && method === 'POST') {
      const g = { id: 'new', ...JSON.parse(String(init.body)), on: false, entries: [] };
      groups.push(g);
      return json({ ok: true, group: g }, 201);
    }
    const [, id, , steamId] = path.split('/');
    const g = groups.find((x) => x.id === id)!;
    if (method === 'GET') return json({ ok: true, entries: g.entries.map((s) => ({ steamId: s })) });
    if (method === 'POST') {
      const s = JSON.parse(String(init.body)).steamId;
      if (s === failAdd) return json({ ok: false }, 500);
      g.entries.push(s);
      return json({ ok: true }, 201);
    }
    g.entries = g.entries.filter((s) => s !== steamId);
    return json({ ok: true });
  }) as typeof fetch;
  return { fetch: fakeFetch, calls, groups };
}

const opts = { baseUrl: 'https://w', token: 'k', orgId: 'org1' };

describe('syncSlotGroup', () => {
  it('creates the group switched off when missing and fills it', async () => {
    const w = fakeWarcon([{ id: 'other', name: 'Streamers', on: true, entries: ['x'] }]);
    const r = await syncSlotGroup({ ...opts, steamIds: ['a', 'b'], fetch: w.fetch });
    expect(r).toEqual({ added: 2, removed: 0, failed: 0, on: false });
    expect(w.groups.find((g) => g.name === SLOT_GROUP)?.entries).toEqual(['a', 'b']);
    expect(w.groups[0].entries).toEqual(['x']); // other groups untouched
  });

  it('adds the missing, removes the lapsed, leaves the rest, and counts failures', async () => {
    const w = fakeWarcon([{ id: 'g1', name: 'premium (SITE)', on: true, entries: ['a', 'gone'] }], 'c');
    const r = await syncSlotGroup({ ...opts, steamIds: ['a', 'b', 'c'], fetch: w.fetch });
    expect(r).toEqual({ added: 1, removed: 1, failed: 1, on: true });
    expect(w.groups[0].entries).toEqual(['a', 'b']);
    expect(w.calls.filter((c) => c.startsWith('POST /'))).toEqual(['POST /g1/entries', 'POST /g1/entries']);
  });

  it('is off without both settings', () => {
    expect(slotSyncConfig({ WARCON_SLOTS_TOKEN: 'k' })).toBeNull();
    expect(slotSyncConfig({ WARCON_SLOTS_TOKEN: ' k ', WARCON_ORG_ID: 'o' })).toEqual({ token: 'k', orgId: 'o' });
  });
});

describe('runSlotSync', () => {
  const store = (tiers: (1 | 2 | 3)[]) => ({ tiered: () => tiers.map((tier, i) => ({ steamId: `s${i}`, tier, linkedAt: 0 })) }) as unknown as Store;

  it('runs one sync at a time, only Prio 1 and 2, and never with an empty list', async () => {
    process.env.WARCON_SLOTS_TOKEN = 'k';
    process.env.WARCON_ORG_ID = 'org1';
    const real = globalThis.fetch;
    const w = fakeWarcon([{ id: 'g1', name: SLOT_GROUP, on: true, entries: ['old'] }]);
    globalThis.fetch = w.fetch;
    try {
      expect(runSlotSync(store([3]), 'https://w')).toBeNull();
      const first = runSlotSync(store([1, 2, 3]), 'https://w');
      expect(first?.wanted).toBe(2);
      expect(runSlotSync(store([1]), 'https://w')).toBeNull();
      expect(await first!.done).toEqual({ added: 2, removed: 1, failed: 0, on: true });
      expect(runSlotSync(store([1, 2]), 'https://w')).not.toBeNull();
    } finally {
      globalThis.fetch = real;
      delete process.env.WARCON_SLOTS_TOKEN;
      delete process.env.WARCON_ORG_ID;
    }
  });
});
