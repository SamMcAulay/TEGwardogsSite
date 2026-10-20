import { siteEnv } from '@/lib/server/warcon/env';
import { warconHealth } from '@/lib/server/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    siteEnv();
  } catch (e) {
    console.error('[health] invalid configuration:', e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, error: 'config' }, { status: 503 });
  }
  const { state, servers } = await warconHealth();
  return Response.json({ ok: true, warcon: state, servers });
}
