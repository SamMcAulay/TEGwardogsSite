import type { MetadataRoute } from 'next';
import { siteEnv } from '@/lib/server/warcon/env';

// Read at request time: SITE_URL and ALLOW_INDEXING are set on the server, not at build time.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const { siteUrl, allowIndexing } = siteEnv();
  return allowIndexing
    ? { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${siteUrl}/sitemap.xml` }
    : { rules: { userAgent: '*', disallow: '/' } };
}
