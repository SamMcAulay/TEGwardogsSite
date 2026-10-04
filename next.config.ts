import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker / a VPS (see README).
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  // HSTS and TLS are Cloudflare's job (docs/DEPLOYMENT.md); these are the app-level ones.
  headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The public JSON API is meant to be read from other sites (Discord bots, overlays).
        source: '/api/:path((?!ingest).*)',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ];
  },
};

export default nextConfig;
