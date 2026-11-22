import { expect, test } from '@playwright/test';

const publisherId = '5361898162179630';

test('public pages execute the AdSense bootstrap once with the supplied attributes', async ({ page }) => {
  const scriptUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-${publisherId}`;
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

test('public pages expose one AdSense ownership tag in the head', async ({ request }) => {
  // The first requests compile three public routes on a cold dev server.
  test.setTimeout(90_000);
  for (const path of ['/', '/gemini-watermark-remover', '/blog']) {
    const response = await request.get(path, { timeout: 90_000 });
    expect(response.status(), path).toBe(200);
    const head = (await response.text()).match(/<head>[\s\S]*?<\/head>/)?.[0] ?? '';
    expect(head.match(/<meta\b[^>]*name="google-adsense-account"[^>]*>/g), path).toEqual([
      `<meta name="google-adsense-account" content="ca-pub-${publisherId}">`,
    ]);
  }
});

test('the site root serves the authorized seller record as plain text', async ({ request }) => {
  const response = await request.get('/ads.txt', { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain(?:;|$)/i);
  expect((await response.text()).replace(/\r?\n$/, '')).toBe(
    `google.com, pub-${publisherId}, DIRECT, f08c47fec0942fa0`,
  );
});

test('the workspace and OAuth popup exclude the public AdSense integration', async ({ request }) => {
  // A cold Astro dev server compiles the separate App graph on this first request.
  test.setTimeout(90_000);
  for (const path of ['/app/image', '/auth/popup']) {
    const response = await request.get(path, { timeout: 90_000 });
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).not.toContain('adsbygoogle.js');
    expect(html, path).not.toContain('google-adsense-account');
  }
});
