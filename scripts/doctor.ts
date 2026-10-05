// npm run doctor / docker compose run --rm doctor: exits non-zero unless every check passes.
import { createApi } from '../src/lib/server/warcon/api';
import { TtlCache } from '../src/lib/server/warcon/cache';
import { runChecks } from '../src/lib/server/warcon/doctor';
import { loadSiteEnv } from '../src/lib/server/warcon/env';
import { createWarcon } from '../src/lib/server/warcon/http';

async function main() {
  let env;
  try {
    env = loadSiteEnv();
  } catch (e) {
    console.log(`FAIL  config: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  console.log(`ok    config: Warcon at ${env.warconBaseUrl}, site ${env.siteUrl}`);
  const api = createApi(createWarcon({ baseUrl: env.warconBaseUrl, token: env.warconToken }), new TtlCache());
  const checks = await runChecks(api, env);
  for (const c of checks) console.log(`${c.ok ? 'ok   ' : 'FAIL '} ${c.name}: ${c.detail}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

void main();
