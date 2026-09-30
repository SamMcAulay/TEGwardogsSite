import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker / a VPS (see README).
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
};

export default nextConfig;
