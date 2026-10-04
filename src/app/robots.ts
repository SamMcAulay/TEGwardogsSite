import type { MetadataRoute } from 'next';

// Read at request time: SITE_URL is set on the server, not at build time.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const site = process.env.SITE_URL?.replace(/\/+$/, '');
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: site ? `${site}/sitemap.xml` : undefined,
  };
}
