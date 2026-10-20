import type { MetadataRoute } from 'next';

/** What a phone needs to install the site as an app (Add to Home Screen / Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TEG WARDOGS Stats',
    short_name: 'WARDOGS',
    description: 'Live servers, leaderboards and player stats for the TEG WARDOGS servers.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#07090c',
    theme_color: '#07090c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
