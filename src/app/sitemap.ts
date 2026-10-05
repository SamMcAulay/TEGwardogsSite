import type { MetadataRoute } from 'next';
import { getServers } from '@/lib/server/data';
import { siteEnv } from '@/lib/server/warcon/env';

export const dynamic = 'force-dynamic';

const PAGES = ['', '/servers', '/leaderboards', '/players', '/matches', '/feed'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { siteUrl } = siteEnv();
  const servers = await getServers().then((l) => l.data, () => []);
  return [
    ...PAGES.map((p) => ({ url: siteUrl + p, changeFrequency: 'hourly' as const })),
    ...servers.map((s) => ({ url: `${siteUrl}/servers/${s.id}`, changeFrequency: 'always' as const })),
  ];
}
