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
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // The AdSense contract test fulfills its script through Playwright routing.
      // Live ads and regional Google Ads audience requests can hold local navigation open.
      launchOptions: { args: ['--host-resolver-rules=MAP pagead2.googlesyndication.com ~NOTFOUND, MAP www.google.* ~NOTFOUND'] },
    },
  }],
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: e2eOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SITE_URL: e2eOrigin, ASTRO_DEV_BACKGROUND: '1' },
  },
});

