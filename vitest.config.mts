import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      DEMO_MODE: 'true',
      SERVERS_CONFIG: '/nonexistent/servers.json',
      WARCON_BASE_URL: 'http://warcon.test',
      WARCON_TOKEN: 'test-token',
      SITE_URL: 'https://stats.test',
    },
  },
});
