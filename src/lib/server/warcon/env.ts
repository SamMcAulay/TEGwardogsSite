// Site configuration from the environment. Everything the site needs to reach Warcon.

export interface SiteEnv {
  warconBaseUrl: string;
  warconToken: string;
  /** public origin, for canonical links, sitemap.xml and robots.txt */
  siteUrl: string;
  /** Warcon server ids to show, in order; empty: every server the key sees */
  serverIds: string[];
  /** false keeps search engines out (the temporary address) */
  allowIndexing: boolean;
}

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export function loadSiteEnv(src: Record<string, string | undefined> = process.env): SiteEnv {
  const missing: string[] = [];
  const req = (key: string) => {
    const v = (src[key] ?? '').trim();
    if (!v) missing.push(key);
    return v.replace(/\/+$/, '');
  };
  const warconBaseUrl = req('WARCON_BASE_URL');
  const warconToken = req('WARCON_TOKEN');
  const siteUrl = req('SITE_URL');
  if (missing.length) throw new Error(`Missing required environment variables:\n  ${missing.join('\n  ')}`);
  for (const [key, v] of [['WARCON_BASE_URL', warconBaseUrl], ['SITE_URL', siteUrl]] as const) {
    if (!isHttpUrl(v)) throw new Error(`${key} must be an absolute http(s) URL, got: ${v}`);
  }
  return {
    warconBaseUrl,
    warconToken,
    siteUrl,
    serverIds: (src.SERVER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    allowIndexing: (src.ALLOW_INDEXING ?? '').trim() === 'true',
  };
}

let memo: SiteEnv | null = null;
export function siteEnv(): SiteEnv {
  return (memo ??= loadSiteEnv());
}
