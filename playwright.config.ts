import { defineConfig, devices } from '@playwright/test';

const e2eOrigin = 'http://127.0.0.1:4379';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL: e2eOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx astro dev --host 127.0.0.1 --port 4379',
    url: e2eOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SITE_URL: e2eOrigin, ASTRO_DEV_BACKGROUND: '1' },
  },
});

