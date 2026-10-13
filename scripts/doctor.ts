// npm run doctor / docker compose run --rm doctor: exits non-zero unless every check passes.
import { runAccountChecks } from '../src/lib/server/accounts/doctor';
import { loadAccountsEnv } from '../src/lib/server/accounts/env';
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
  try {
    const accounts = loadAccountsEnv();
    if (accounts) checks.push(...(await runAccountChecks(accounts)));
    else console.log('ok    accounts: not configured (sign-in, badges and /api/priority off)');
  } catch (e) {
    checks.push({ name: 'accounts config', ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
  for (const c of checks) console.log(`${c.ok ? 'ok   ' : 'FAIL '} ${c.name}: ${c.detail}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

void main();
