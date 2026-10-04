import type { MetadataRoute } from 'next';
import { getServers } from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

const PAGES = ['', '/servers', '/leaderboards', '/matches', '/players', '/weapons', '/feed', '/compare', '/api-docs'];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return [
    ...PAGES.map((p) => ({ url: site + p, changeFrequency: 'hourly' as const })),
    ...getServers().map((s) => ({ url: `${site}/servers/${s.id}`, changeFrequency: 'always' as const })),
  ];
}
