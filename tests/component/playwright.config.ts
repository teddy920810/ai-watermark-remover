import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: fileURLToPath(new URL('../../test-results/components', import.meta.url)),
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4391', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], hasTouch: true } }],
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: 'node node_modules/astro/bin/astro.mjs dev --root tests/fixtures/image-display --host 127.0.0.1 --port 4391',
    url: 'http://127.0.0.1:4391', reuseExistingServer: false, timeout: 120_000,
    env: { ASTRO_DEV_BACKGROUND: '1' },
  },
});
