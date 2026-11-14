import { expect, test } from '@playwright/test';

test('public pages execute the AdSense bootstrap once with the supplied attributes', async ({ page }) => {
  const scriptUrl = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5361898162179630';
  let requests = 0;
  await page.route(scriptUrl, async (route) => {
    requests += 1;
    await route.fulfill({ contentType: 'application/javascript', body: 'window.__adsenseBootstrapLoaded = true;' });
  });
  // The async vendor bootstrap is independent of the dev server's React module graph.
  await page.goto('/', { waitUntil: 'commit' });
  const script = page.locator('head script[src*="adsbygoogle.js"]');
  await expect(script).toHaveCount(1);
  await expect(script).toHaveAttribute('src', scriptUrl);
  await expect(script).toHaveAttribute('async', '');
  await expect(script).toHaveAttribute('crossorigin', 'anonymous');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__adsenseBootstrapLoaded'))).toBe(true);
  expect(requests).toBe(1);
});

test('private workspaces do not load the public advertising bootstrap', async ({ request }) => {
  // A cold Astro dev server compiles the separate App graph on this first request.
  test.setTimeout(90_000);
  const response = await request.get('/app/image', { timeout: 90_000 });
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain('adsbygoogle.js');
});
