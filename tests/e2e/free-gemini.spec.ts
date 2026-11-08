import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { geminiImage } from '../helpers/gemini-fixtures';
const read = promisify(readFile);
const origin = 'http://127.0.0.1:4379';
test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 1024 } });

async function setup(context: BrowserContext, signedIn = true, pending = false) {
  const state = { signedIn, uploads: 0, quotes: 0, submissions: 0, put: null as Buffer | null, forbidden: [] as string[] };
  await context.route('**/api/auth/get-session', route => route.fulfill({ json: state.signedIn ? { user: { id: 'free-gemini-owner', name: 'Gemini tester' }, session: { id: 'gemini-session' } } : null }));
  await context.route('**/api/v1/**', async route => {
    const req = route.request(); const pathname = new URL(req.url()).pathname;
    if (pathname.endsWith('/capabilities')) return route.fulfill({ json: { operations: [
      { operation: 'image-watermark', enabled: true, acceptedTypes: ['image/png'], maxBytes: 10_485_760 },
      { operation: 'video-watermark', enabled: true, acceptedTypes: ['video/mp4'], maxBytes: 104_857_600, requiredFps: 24, maxDurationSeconds: 540 },
    ] } });
    if (pathname.endsWith('/jobs') && req.method() === 'GET') return route.fulfill({ json: { jobs: pending ? [{ id: 'saved-unknown', operation: 'image-watermark', status: 'UNKNOWN' }] : [] } });
    if (pathname.endsWith('/me')) return route.fulfill({ json: { walletMode: 'unified', credits: 0, unit: 'credits', admissionEnabled: true } });
    if (pathname.endsWith('/uploads')) { state.uploads++; return route.fulfill({ status: 201, json: { id: 'handoff-upload', uploadUrl: `${origin}/fixture/gemini-upload` } }); }
    if (pathname.endsWith('/complete')) return route.fulfill({ status: 202, json: { status: 'validating' } });
    if (pathname.endsWith('/uploads/handoff-upload')) return route.fulfill({ json: { id: 'handoff-upload', status: 'ready', artifact: { id: 'handoff-input', role: 'input', metadata: { kind: 'image', contentType: 'image/png', width: 1024, height: 1024, byteSize: 10000 }, previewUrl: `${origin}/fixture/gemini-input`, expiresAt: new Date(Date.now() + 86400000).toISOString() } } });
    if (pathname.endsWith('/quotes')) { state.quotes++; return route.fulfill({ status: 201, json: { id: 'gemini-paid-quote', operation: 'image-watermark', amount: 100, unit: 'credits', expiresAt: new Date(Date.now() + 300000).toISOString(), expectedOutput: { format: 'JPG', contentType: 'image/jpeg', width: 1024, height: 1024 } } }); }
    if (req.method() === 'POST') state.submissions++;
    return route.fulfill({ status: 409, json: { error: 'No paid processing is authorized by this test.' } });
  });
  await context.route('**/fixture/gemini-upload', route => { state.put = route.request().postDataBuffer(); return route.fulfill({ status: 200 }); });
  await context.route('**/fixture/gemini-input', async route => route.fulfill({ contentType: 'image/png', body: await geminiImage() }));
  context.on('request', request => { if (/dewatermark|replicate|amazonaws|r2\.cloudflarestorage/.test(request.url())) state.forbidden.push(request.url()); });
  return state;
}
async function imageResult(page: Page) {
  await page.goto('/app/free/gemini');
  await expect(page.getByRole('heading', { name: 'Free Gemini watermark remover' })).toBeVisible();
  const input = await geminiImage();
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'gemini-source.png', mimeType: 'image/png', buffer: input });
  await expect(page.getByRole('button', { name: 'Remove watermark — Free' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await expect(page.getByRole('heading', { name: 'Your image is ready' })).toBeVisible({ timeout: 60000 });
  return input;
}

test('zero-balance image processing downloads real PNGs without media uploads or charges', async ({ page, context }) => {
  await page.addInitScript(() => {
    const tracked = window as unknown as Window & { geminiEvents: unknown[][]; gtag: (...args: unknown[]) => void };
    tracked.geminiEvents = []; tracked.gtag = (...args) => tracked.geminiEvents.push(args);
  });
  const state = await setup(context); await imageResult(page);
  for (let i = 0; i < 2; i++) {
    const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download PNG — Free' }).click();
    const file = await download; expect(file.suggestedFilename()).toBe('gemini-cleaned-image.png');
    const metadata = await sharp(await read((await file.path())!)).metadata(); expect(metadata).toMatchObject({ format: 'png', width: 1024, height: 1024 });
    const decoded = await sharp(await read((await file.path())!)).ensureAlpha().raw().toBuffer();
    expect(decoded[3]).toBe(0); expect(decoded[7]).toBe(128);
  }
  expect(state.uploads).toBe(0); expect(state.quotes).toBe(0); expect(state.submissions).toBe(0); expect(state.forbidden).toEqual([]);
  const events = await page.evaluate(() => (window as unknown as Window & { geminiEvents: unknown[][] }).geminiEvents);
  expect(events.filter(event => event[1] === 'gemini_free_download_started')).toHaveLength(1);
  expect(JSON.stringify(events)).not.toMatch(/gemini-source|blob:|http:|data:/);
  await page.screenshot({ path: 'output/gemini-free/image-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 970, height: 714 });
  await page.screenshot({ path: 'output/gemini-free/image-design-size.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Original', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByAltText('Original image')).toBeVisible();
  await page.screenshot({ path: 'output/gemini-free/image-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toBeVisible();
  await context.route('**/api/auth/sign-out', route => { state.signedIn = false; return route.fulfill({ json: { success: true } }); });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByAltText('Original image')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('unmarked image is not reported as successful and cancellation preserves the original', async ({ page, context }) => {
  await setup(context); await page.goto('/app/free/gemini');
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'no-mark.png', mimeType: 'image/png', buffer: await geminiImage(false) });
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cancelled' })).toBeVisible(); await expect(page.getByAltText('Original image')).toBeVisible();
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await expect(page.getByRole('alert')).toContainText('No supported Gemini watermark detected', { timeout: 60000 });
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try paid AI removal' })).toBeVisible();
});

test('sign-in keeps the local file and requires another explicit click to process', async ({ page, context }) => {
  const state = await setup(context, false);
  await context.route('**/api/auth/sign-in/social', route => { state.signedIn = true; return route.fulfill({ json: { url: `${origin}/fixture/gemini-sign-in`, redirect: false } }); });
  await context.route('**/fixture/gemini-sign-in', route => route.fulfill({ contentType: 'text/html', body: `<script>opener.postMessage({type:'clearmark-auth-complete'},${JSON.stringify(origin)});close()</script>` }));
  await page.goto('/app/free/gemini');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'gemini.png', mimeType: 'image/png', buffer: await geminiImage() });
  await page.getByRole('button', { name: 'Sign in to process for free' }).click();
  await expect(page.getByRole('button', { name: 'Remove watermark — Free' })).toBeVisible();
  await expect(page.getByAltText('Original image')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toHaveCount(0);
  expect(state.uploads).toBe(0); expect(state.submissions).toBe(0);
});

test('session expiry during local processing keeps the completed free download', async ({ page, context }) => {
  const state = await setup(context); await page.goto('/app/free/gemini');
  await expect(page.getByLabel('Choose a Gemini image or video')).toBeEnabled();
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'expiry.png', mimeType: 'image/png', buffer: await geminiImage() });
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Processing your image' })).toBeVisible();
  state.signedIn = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toBeVisible({ timeout: 30000 });
  expect(state.uploads).toBe(0); expect(state.submissions).toBe(0);
});

test('the public Gemini entry restores its original file after session loading', async ({ page, context }) => {
  const state = await setup(context);
  await page.goto('/gemini-watermark-remover');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  await page.getByTestId('media-launcher-file').setInputFiles({ name: 'public-gemini.png', mimeType: 'image/png', buffer: await geminiImage() });
  await expect(page).toHaveURL(/\/app\/free\/gemini/);
  await expect(page.getByAltText('Original image')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Remove watermark — Free' })).toBeVisible();
  expect(state.uploads).toBe(0); expect(state.submissions).toBe(0);
});

for (const failure of ['expired', 'another-account']) test(`handoff rejects ${failure} files before upload`, async ({ page, context }) => {
  const state = await setup(context); await page.goto('/app/free/gemini');
  await expect(page.getByRole('heading', { name: 'Free Gemini watermark remover' })).toBeVisible();
  const id = await page.evaluate(async failure => {
    const path = '/src/lib/client/media-drafts.ts'; const { savePaidHandoff } = await import(path);
    const draft = await savePaidHandoff(new File([new Uint8Array([1, 2, 3])], 'owned.png', { type: 'image/png' }), 'image', failure === 'another-account' ? 'other-owner' : 'free-gemini-owner');
    if (failure === 'expired') {
      draft.expiresAt = Date.now() - 1;
      await new Promise<void>((resolve, reject) => { const request = indexedDB.open('watermarkgemini-media-drafts-v1', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const transaction = db.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put(draft); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => reject(transaction.error); }; });
    }
    return draft.id;
  }, failure);
  await page.goto(`/app?operation=image-watermark&handoff=${encodeURIComponent(id)}`);
  await expect(page.getByRole('heading', { name: 'File handoff paused' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('expired or belongs to another account');
  expect(state.uploads).toBe(0); expect(state.submissions).toBe(0);
});

test('paid handoff preserves the free result, uploads the original and never starts a paid task automatically', async ({ page, context }) => {
  const state = await setup(context); const original = await imageResult(page);
  const popup = context.waitForEvent('page'); await page.getByRole('button', { name: 'Try paid AI removal' }).click(); const paid = await popup;
  await expect(paid.getByRole('heading', { name: 'Remove image watermarks' })).toBeVisible({ timeout: 30000 });
  await expect.poll(() => state.quotes).toBeGreaterThan(0); expect(state.put).toEqual(original); expect(state.submissions).toBe(0);
  await paid.reload();
  await expect(paid.getByRole('heading', { name: 'Remove image watermarks' })).toBeVisible({ timeout: 30000 });
  expect(state.uploads).toBe(1); expect(state.submissions).toBe(0);
  await expect(page.getByRole('link', { name: 'Download PNG — Free' })).toBeVisible();
  await page.getByRole('button', { name: 'Try paid AI removal' }).click(); expect(context.pages()).toHaveLength(2); expect(state.submissions).toBe(0);
});

test('a pending paid task blocks handoff without replacing it or uploading another file', async ({ page, context }) => {
  const state = await setup(context, true, true); await imageResult(page);
  const popup = context.waitForEvent('page'); await page.getByRole('button', { name: 'Try paid AI removal' }).click(); const paid = await popup;
  await expect(paid.getByRole('heading', { name: 'File handoff paused' })).toBeVisible({ timeout: 30000 });
  await expect(paid.getByRole('link', { name: 'Reopen saved task' })).toHaveAttribute('href', '/app/image?job=saved-unknown');
  expect(state.uploads).toBe(0); expect(state.submissions).toBe(0);
});

test('video uses the real local engine, retains audio and downloads a playable MP4', async ({ page, context }) => {
  test.setTimeout(120000); const state = await setup(context); await page.goto('/app/free/gemini');
  await expect(page.getByRole('heading', { name: 'Free Gemini watermark remover' })).toBeVisible();
  const audioFixture = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url)).toString('base64');
  const encoded = await page.evaluate(async audioFixture => { const path = '/tests/helpers/gemini-video-fixture.ts'; return (await import(path)).createGeminiVideo(audioFixture); }, audioFixture);
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'gemini-video.mp4', mimeType: 'video/mp4', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.getByRole('button', { name: 'Remove watermark — Free' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download MP4 — Free' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Cancelled' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await expect(page.getByRole('heading', { name: 'Your video is ready' })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Audio preserved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play comparison' }).click(); await expect(page.getByRole('button', { name: 'Pause comparison' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause comparison' }).click();
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download MP4 — Free' }).click(); const file = await download;
  expect(file.suggestedFilename()).toBe('gemini-cleaned-video.mp4');
  const bytes = await read((await file.path())!); expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
  const metadata = await page.evaluate(async encoded => { const path = '/tests/helpers/gemini-video-fixture.ts'; return (await import(path)).inspectGeminiResult(encoded); }, bytes.toString('base64'));
  expect(metadata).toMatchObject({ width: 1280, height: 720, audio: true }); expect(metadata.duration).toBeCloseTo(2, 0);
  expect(state.uploads).toBe(0); expect(state.quotes).toBe(0); expect(state.submissions).toBe(0); expect(state.forbidden).toEqual([]);
  await page.screenshot({ path: 'output/gemini-free/video-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 970, height: 714 });
  await page.screenshot({ path: 'output/gemini-free/video-design-size.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('slider', { name: 'Video position' }).press('Home');
  await page.getByRole('slider', { name: 'Video position' }).press('ArrowRight');
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Video position' })).toHaveValue('0.01');
  await page.screenshot({ path: 'output/gemini-free/video-mobile.png', fullPage: true });
});

test('30fps video is admitted locally and an unmarked clip does not become a fake successful download', async ({ page, context }) => {
  test.setTimeout(120000); const state = await setup(context); await page.goto('/app/free/gemini');
  await expect(page.getByLabel('Choose a Gemini image or video')).toBeEnabled();
  const fixture = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url)).toString('base64');
  const encoded = await page.evaluate(async fixture => { const path = '/tests/helpers/gemini-video-fixture.ts'; return (await import(path)).createGeminiVideo(fixture, 30, false); }, fixture);
  await page.getByLabel('Choose a Gemini image or video').setInputFiles({ name: 'unmarked-30fps.mp4', mimeType: 'video/mp4', buffer: Buffer.from(encoded, 'base64') });
  await page.getByRole('button', { name: 'Remove watermark — Free' }).click();
  await expect(page.getByRole('alert')).toContainText('No supported Gemini watermark detected', { timeout: 60000 });
  await expect(page.getByRole('link', { name: 'Download MP4 — Free' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try paid AI removal' })).toHaveCount(0);
  await expect(page.getByText(/cloud tool currently requires 24 fps/)).toBeVisible();
  expect(state.uploads).toBe(0); expect(state.submissions).toBe(0);
});
