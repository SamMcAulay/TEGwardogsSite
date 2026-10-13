import { accounts } from '@/lib/server/accounts';
import { safeEqual } from '@/lib/server/accounts/session';

export const dynamic = 'force-dynamic';

/**
 * Queue priority for every linked Steam account with a tier (1 is the front of the queue), for
 * Bulkhead's tiered queue once it exists. Everyone linked since launch is in it, with when they
 * linked, so the queue can start from the full list. Needs `Authorization: Bearer <PRIORITY_API_KEY>`; off
 * (404) until that key is set.
 */
export function GET(req: Request) {
  const a = accounts();
  const key = a?.env.priorityApiKey;
  if (!a || !key) return Response.json({ error: 'not_found' }, { status: 404 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !safeEqual(given, key)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      players: a.store.tiered().map((p) => ({ ...p, linkedAt: new Date(p.linkedAt * 1000).toISOString() })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
