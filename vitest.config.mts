import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      WARCON_BASE_URL: 'http://warcon.test',
      WARCON_TOKEN: 'test-token',
      SITE_URL: 'https://stats.test',
    },
  },
});
