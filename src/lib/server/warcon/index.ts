// Process-wide singletons. Next can load server modules more than once in dev; globalThis keeps
// one cache per process.
import { createApi, type WarconApi } from './api';
import { TtlCache } from './cache';
import { siteEnv } from './env';
import { createWarcon } from './http';

const g = globalThis as unknown as { __warcon?: WarconApi };

export function warcon(): WarconApi {
  if (!g.__warcon) {
    const env = siteEnv();
    g.__warcon = createApi(createWarcon({ baseUrl: env.warconBaseUrl, token: env.warconToken }), new TtlCache());
  }
  return g.__warcon;
}
