import { WarconError } from '@/lib/server/warcon/http';
import { siteEnv } from '@/lib/server/warcon/env';
import { warcon } from '@/lib/server/warcon';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    siteEnv();
  } catch (e) {
    console.error('[health] invalid configuration:', e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, error: 'config' }, { status: 503 });
  }
  try {
    const { value } = await warcon().servers();
    return Response.json({ ok: true, warcon: 'ok', servers: value.length });
  } catch (e) {
    const kind = e instanceof WarconError ? e.kind : 'error';
    const warconState = kind === 'rejected' ? 'key_rejected' : kind === 'forbidden' ? 'key_lacks_view' : kind === 'unreachable' || kind === 'timeout' ? 'unreachable' : 'error';
    return Response.json({ ok: true, warcon: warconState, servers: 0 });
  }
}
