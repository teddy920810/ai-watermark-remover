import { expect, test } from '@playwright/test';
import { waitForWorkspace } from '../helpers/workspace';
import sharp from 'sharp';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, route => route.abort());
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
});

test('the editor shows limits for the active media and a way to switch', async ({ page }) => {
  await page.goto('/app?operation=image-watermark');
  const empty = page.locator('.workspace-empty');
  await expect(empty.getByText('JPG, PNG or WebP · up to 10 MB')).toBeVisible();
  await expect(empty.getByText(/24 fps/)).toHaveCount(0);
  await empty.getByRole('link', { name: 'Switch to video tool' }).click();
  await waitForWorkspace(page);
  await expect(empty.getByText(/MP4.*24 fps.*100 MB/)).toBeVisible();
  await expect(empty.getByText(/JPG, PNG or WebP/)).toHaveCount(0);
});

test('All Tools remains usable while the account request waits', async ({ page }) => {
  let releaseSession!: () => void;
  const pending = new Promise<void>(resolve => { releaseSession = resolve; });
  await page.route('**/api/auth/get-session', async route => {
    await pending;
    await route.fulfill({ json: null });
  });
  try {
    await page.goto('/app?view=tools');
    await expect(page.getByRole('link', { name: /Gemini Watermark Remover Remove/ })).toBeVisible();
  } finally {
    releaseSession();
  }
});

test('recent tasks are requested only on demand and use the summary view', async ({ page }) => {
  const reads: string[] = [];
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'optimization-user' }, session: { id: 'optimization-session' } } }));
  await page.route('**/api/v1/me', route => route.fulfill({ json: { freeUses: 1, processingCredits: 100 } }));
  await page.route(/\/api\/v1\/jobs(?:\?.*)?$/, route => {
    reads.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { jobs: [] } });
  });
  await page.goto('/app?operation=image-watermark');
  await waitForWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Choose a file' })).toBeVisible();
  expect(reads).toEqual([]);
  await page.getByRole('link', { name: 'Recent Tasks' }).click();
  await expect(page.getByText('No tasks yet')).toBeVisible();
  expect(reads).toEqual(['?view=summary']);
});

test('an interrupted status check reconnects to the original job without submitting again', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'optimization-user' }, session: { id: 'optimization-session' } } }));
  await page.route('**/api/v1/me', route => route.fulfill({ json: { freeUses: 1, processingCredits: 100 } }));
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() !== 'GET') calls.push(route.request().method());
    return route.fulfill({ json: { jobs: [] } });
  });
  let reads = 0;
  await page.route('**/api/v1/jobs/reconnect-job', route => {
    reads += 1;
    if (reads === 2) return route.fulfill({ status: 503, json: { error: 'Interrupted' } });
    return route.fulfill({ json: { id: 'reconnect-job', operation: 'image-watermark', status: reads >= 3 ? 'FAILED' : 'PROCESSING', charge: { status: reads >= 3 ? 'refunded' : 'reserved', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() } });
  });
  await page.goto('/app?operation=image-watermark&job=reconnect-job');
  await expect(page.getByText(/Connection interrupted\. Your task remains saved/)).toBeVisible({ timeout: 12000 });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => reads).toBe(3);
  expect(calls).toEqual([]);
});

test('the object editor snapshots only touched tiles on a 4000 by 3000 image', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const capture = CanvasRenderingContext2D.prototype.getImageData;
    const readbacks: { bytes: number; durationMs: number }[] = [];
    Object.assign(window, { maskReadbacks: readbacks });
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, width, height, ...options) {
      const started = performance.now();
      const result = capture.call(this, x, y, width, height, ...options);
      if (this.canvas.width === 4000 && this.canvas.height === 3000) {
        readbacks.push({ bytes: result.data.byteLength, durationMs: performance.now() - started });
      }
      return result;
    };
  });
  const image = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#daf7e7' } }).jpeg().toBuffer();
  await page.goto('/app?operation=object-removal', { waitUntil: 'domcontentloaded' });
  await waitForWorkspace(page);
  await page.getByLabel('Upload file to workspace').setInputFiles({ name: 'large-sample.jpg', mimeType: 'image/jpeg', buffer: image });
  const canvas = page.locator('.object-editor-stage canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5);
  const evidence = await page.evaluate(() => (window as unknown as { maskReadbacks: { bytes: number; durationMs: number }[] }).maskReadbacks);
  await page.mouse.up();
  expect(evidence.length).toBeGreaterThan(0);
  expect(evidence.reduce((sum, sample) => sum + sample.bytes, 0)).toBeLessThan(1024 * 1024);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  const alpha = await canvas.evaluate(element => (element as HTMLCanvasElement).getContext('2d')!.getImageData(2000, 1500, 1, 1).data[3]);
  expect(alpha).toBe(0);
  await test.info().attach('gesture-readbacks.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('the tool list distinguishes no sign-in from account allowances', async ({ page }) => {
  await page.goto('/app?view=tools');
  await expect(page.getByText('Ready for everyone. No account or Credits needed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Sign-in tools/i })).toBeVisible();
  await expect(page.getByText(/Older accounts may have free image uses/)).toBeVisible();
});

test('only the selected hero sample requests full comparison images', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image') requests.push(request.url()); });
  await page.goto('/gemini-watermark-remover');
  const pair = page.locator('[data-landing-preview]').nth(1);
  const afterPath = await pair.locator('[data-image-side="after"] img').getAttribute('src');
  expect(afterPath).toBeTruthy();
  await expect(page.locator('[data-landing-preview]').first().getByRole('slider')).toBeVisible();
  expect(requests.some(url => new URL(url).pathname === afterPath)).toBe(false);
  await page.locator('[data-landing-sample]').nth(1).click();
  await expect(pair.getByRole('slider')).toBeVisible();
});

test('blog archive links reach every published blog entry exactly once', async ({ page, request }) => {
  test.setTimeout(90_000);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const expected = [...sitemap.matchAll(/<loc>[^<]+?(\/blog\/[^<]+)<\/loc>/g)].map(match => match[1]);
  const seen: string[] = [];
  await page.goto('/blog', { waitUntil: 'domcontentloaded' });
  for (let index = 0; index < expected.length; index++) {
    seen.push(...await page.locator('.blog-list h2 a').evaluateAll(links => links.map(link => link.getAttribute('href')!)));
    const next = page.getByRole('link', { name: 'Older posts' });
    if (await next.count() === 0) break;
    await page.goto((await next.getAttribute('href'))!, { waitUntil: 'domcontentloaded' });
  }
  expect(seen.sort()).toEqual(expected.sort());
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/blog\/page\/\d+$/);
  await expect(page.getByRole('link', { name: 'Newer posts' })).toBeVisible();
});

test('mobile tool navigation focuses the current destination and returns focus on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?view=tools');
  const toggle = page.getByRole('button', { name: 'Open tool navigation' });
  await toggle.press('Enter');
  const current = page.getByRole('navigation', { name: 'Workspace tools' }).getByRole('link', { name: 'All Tools' });
  await expect(current).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
