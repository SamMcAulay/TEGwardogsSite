// Whether Warcon answers with our key: the public /api/health and the staff health panel.
import { WarconError } from './warcon/http';
import { warcon } from './warcon';

export type WarconState = 'ok' | 'key_rejected' | 'key_lacks_view' | 'unreachable' | 'error';

export async function warconHealth(): Promise<{ state: WarconState; servers: number }> {
  try {
    const { value } = await warcon().servers();
    return { state: 'ok', servers: value.length };
  } catch (e) {
    const kind = e instanceof WarconError ? e.kind : 'error';
    const state =
      kind === 'rejected'
        ? 'key_rejected'
        : kind === 'forbidden'
          ? 'key_lacks_view'
          : kind === 'unreachable' || kind === 'timeout'
            ? 'unreachable'
            : 'error';
    return { state, servers: 0 };
  }
}
