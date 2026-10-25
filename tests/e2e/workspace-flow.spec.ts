import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

const origin = 'http://127.0.0.1:4379';
const expiration = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const quoteExpiration = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();
const capabilities = { operations: ['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark'].map(operation => ({ operation, enabled: true, acceptedTypes: operation === 'video-watermark' ? ['video/mp4'] : ['image/jpeg', 'image/png', 'image/webp'], maxBytes: operation === 'video-watermark' ? 100 * 1024 * 1024 : 10 * 1024 * 1024 })) };
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
let downloadServer: Server;
let downloadOrigin = '';
const downloadFiles = new Map<string, { contentType: string; name: string; bytes: Buffer }>();
test.beforeAll(async () => {
  // Chromium moves download-attribute requests outside page interception. Use real HTTP bytes.
  downloadServer = createServer((request, response) => {
    const file = downloadFiles.get(request.url ?? '');
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': file.bytes.length, 'Content-Disposition': `attachment; filename="${file.name}"` }); response.end(file.bytes);
  });
  await new Promise<void>(resolve => downloadServer.listen(0, '127.0.0.1', resolve));
  const address = downloadServer.address(); if (!address || typeof address === 'string') throw new Error('Download fixture server failed');
  downloadOrigin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => downloadServer?.close(error => error ? reject(error) : resolve())); });
async function account(page: Page, signedIn = true) {
  await page.route('**/api/auth/get-session', route => json(route, signedIn ? { user: { id: 'workspace-test-user', name: 'Test user' }, session: { id: 'workspace-session' } } : null));
  await page.route('**/api/v1/capabilities', route => json(route, capabilities));
  await page.route('**/api/v1/me', route => json(route, { freeUses: 1, processingCredits: 100 }));
  await page.route('**/api/v1/jobs', route => route.request().method() === 'GET' ? json(route, { jobs: [] }) : route.continue());
}
test('landing hands an anonymous file to the workspace and restores it without an upload or charge', async ({ page }) => {
  await account(page, false);
  let processingRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/v1\/(uploads|quotes|jobs)/.test(request.url())) processingRequests += 1; });
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#dab77a' } }).png().toBuffer();
  await page.goto('/');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  await page.getByTestId('media-launcher-file').setInputFiles({ name: 'my-product.png', mimeType: 'image/png', buffer: image });
  await expect(page).toHaveURL(/\/app\/image$/);
  await expect(page.getByText('my-product.png', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to upload' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('my-product.png', { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(processingRequests).toBe(0);
});

for (const scenario of [
  { name: 'image removal', operation: 'image-watermark', amount: 1, unit: 'freeUses', cost: '1 free image use', canRefine: true },
  { name: 'PRO image removal', operation: 'image-watermark-pro', amount: 3, unit: 'processingCredits', cost: '3 processing credits', canRefine: false },
] as const) test(`${scenario.name} checks the file, requires a cost confirmation, and downloads a renewed real artifact`, async ({ page }) => {
  await account(page);
  const image = await sharp({ create: { width: 100, height: 75, channels: 3, background: '#c9b07b' } }).png().toBuffer();
  const resultBytes = await sharp(image).jpeg().toBuffer();
  const input = { id: 'input-image', role: 'input', metadata: { kind: 'image', contentType: 'image/png', byteSize: image.length, width: 100, height: 75 }, previewUrl: `${origin}/fixture/source.png`, expiresAt: expiration() };
  const result = { id: 'result-image', role: 'result', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: resultBytes.length, width: 100, height: 75 }, previewUrl: `${origin}/fixture/result.jpg`, expiresAt: expiration(), canRefine: scenario.canRefine };
  const quote = { id: 'quote-image', operation: scenario.operation, amount: scenario.amount, unit: scenario.unit, expiresAt: quoteExpiration(), expectedOutput: { contentType: 'image/jpeg', format: 'JPG', width: 100, height: 75 } };
  const job = { id: 'job-image', status: 'READY', operation: scenario.operation, input, result, charge: { status: 'consumed', amount: scenario.amount, unit: scenario.unit }, createdAt: new Date().toISOString() };
  let submissions = 0; let downloads = 0; let quotes = 0;
  await page.route('**/fixture/source.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: image }));
  await page.route('**/fixture/result.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: resultBytes }));
  await page.route('**/fixture/upload', route => route.fulfill({ status: 200 }));
  await page.route('**/api/v1/uploads', route => json(route, { id: 'upload-image', uploadUrl: `${origin}/fixture/upload`, status: 'created', expiresAt: expiration() }, 201));
  await page.route('**/api/v1/uploads/upload-image/complete', route => json(route, { id: 'upload-image', status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/upload-image', route => json(route, { id: 'upload-image', status: 'ready', artifact: input }));
  await page.route('**/api/v1/quotes', route => { quotes += 1; expect(route.request().postDataJSON()).toMatchObject({ operation: scenario.operation }); return json(route, quote); });
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; expect(route.request().postDataJSON()).toMatchObject({ quoteId: 'quote-image', idempotencyKey: expect.any(String) }); return json(route, { ...job, status: 'QUEUED', result: undefined, charge: { ...job.charge, status: 'reserved' } }, 202); });
  await page.route('**/api/v1/jobs/job-image', route => json(route, job));
  downloadFiles.set('/image.jpg', { contentType: 'image/jpeg', name: 'watermark-removed-image.jpg', bytes: resultBytes });
  await page.route('**/api/v1/jobs/job-image/download', route => { downloads += 1; return json(route, { url: `${downloadOrigin}/image.jpg`, expiresAt: quoteExpiration() }); });
  await page.goto('/app/image');
  await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: image });
  if (scenario.operation === 'image-watermark-pro') await page.getByRole('radio', { name: /^PRO/ }).check();
  await page.getByRole('button', { name: 'Upload & check file' }).click();
  await expect(page.getByText('File checked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review processing cost' }).click();
  await expect(page.getByRole('dialog')).toContainText(scenario.cost);
  expect(submissions).toBe(0);
  await page.getByRole('button', { name: `Confirm & process · ${scenario.amount}` }).click();
  await expect(page.getByRole('button', { name: 'Download JPG', exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByAltText('Original image', { exact: true })).toBeVisible();
  await expect(page.getByAltText('Watermark removal result', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh preview link' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JPG', exact: true }).click();
  const artifact = await download; expect(artifact.suggestedFilename()).toBe('watermark-removed-image.jpg');
  const stream = await artifact.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(await sharp(Buffer.concat(chunks)).metadata()).toMatchObject({ format: 'jpeg', width: 100, height: 75 });
  expect(submissions).toBe(1); expect(quotes).toBe(1); expect(downloads).toBe(1);
  if (scenario.canRefine) await expect(page.getByRole('button', { name: 'Refine remaining marks' })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Refine remaining marks' })).toHaveCount(0);
});

test('unknown provider status never offers a fresh paid replay or a false refund', async ({ page }) => {
  await account(page);
  const image = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#c9b07b' } }).jpeg().toBuffer();
  await page.route('**/fixture/input.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: image }));
  await page.route('**/api/v1/jobs/unknown-job', route => json(route, { id: 'unknown-job', operation: 'image-watermark', status: 'UNKNOWN', input: { id: 'input', role: 'input', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: image.length, width: 60, height: 40 }, previewUrl: `${origin}/fixture/input.jpg`, expiresAt: expiration() }, charge: { status: 'reserved', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() }));
  await page.goto('/app/image?job=unknown-job');
  await expect(page.getByRole('heading', { name: 'Checking the processing confirmation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review processing cost' })).toHaveCount(0);
  await expect(page.getByText('credits returned', { exact: false })).toHaveCount(0);
});

test('an unstarted task timeout returns the allowance and requires a new cost review before retrying', async ({ page }) => {
  await account(page); await page.clock.install();
  const image = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#c9b07b' } }).jpeg().toBuffer();
  const input = { id: 'timeout-input', role: 'input', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: image.length, width: 60, height: 40 }, previewUrl: `${origin}/fixture/timeout.jpg`, expiresAt: expiration() };
  const message = 'The task did not start before the deadline. The reserved allowance was returned. Review the cost to try again.';
  let reads = 0; let submissions = 0; let quotes = 0;
  const job = { id: 'timeout-job', operation: 'image-watermark', input, createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() };
  await page.route('**/fixture/timeout.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: image }));
  await page.route('**/api/v1/me', route => json(route, { freeUses: reads > 1 ? 1 : 0, processingCredits: 0 }));
  await page.route('**/api/v1/jobs/timeout-job', route => {
    reads += 1;
    return json(route, { ...job, status: reads === 1 ? 'QUEUED' : 'REFUNDED', chargeStatus: reads === 1 ? 'reserved' : 'refunded', charge: { status: reads === 1 ? 'reserved' : 'refunded', amount: 1, unit: 'freeUses' }, ...(reads > 1 ? { errorCode: 'dispatch_timeout', error: message } : {}) });
  });
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() === 'GET') return json(route, { jobs: [] });
    submissions += 1; return json(route, { error: 'A retry requires explicit confirmation.' }, 409);
  });
  await page.route('**/api/v1/quotes', route => {
    quotes += 1; expect(route.request().postDataJSON()).toEqual({ operation: 'image-watermark', inputArtifactId: input.id });
    return json(route, { id: 'timeout-retry-quote', operation: 'image-watermark', amount: 1, unit: 'freeUses', expiresAt: quoteExpiration(), expectedOutput: { contentType: 'image/jpeg', format: 'JPG', width: 60, height: 40 } });
  });
  await page.goto('/app/image?job=timeout-job');
  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
  await expect(page.getByText('0 free image uses', { exact: true })).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText('Your reserved credits were returned.', { exact: true })).toBeVisible();
  await expect(page.getByText('1 free image uses', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review processing cost', exact: true })).toBeEnabled();
  expect(submissions).toBe(0); expect(quotes).toBe(0);
  await page.getByRole('button', { name: 'Review processing cost', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1 free image use');
  await expect(page.getByRole('button', { name: 'Confirm & process · 1' })).toBeEnabled();
  expect(submissions).toBe(0); expect(quotes).toBe(1);
  await page.getByRole('button', { name: 'Close cost review' }).click(); await page.reload();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(submissions).toBe(0); expect(quotes).toBe(1);
});

test('refinement sends an opaque binary mask and keeps the previous result when the new attempt fails', async ({ page }) => {
  await account(page);
  const image = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#e8c991' } }).jpeg().toBuffer();
  const input = { id: 'base-input', role: 'input', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: image.length, width: 160, height: 120 }, previewUrl: `${origin}/fixture/base.jpg`, expiresAt: expiration() };
  const result = { ...input, id: 'previous-result', role: 'result', canRefine: true };
  const previous = { id: 'previous-job', status: 'READY', operation: 'image-watermark', input, result, charge: { status: 'consumed', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() };
  let maskBytes: Buffer | null = null;
  await page.route('**/fixture/base.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: image }));
  await page.route('**/api/v1/jobs', route => route.request().method() === 'GET' ? json(route, { jobs: [previous] }) : json(route, { id: 'refinement-job', status: 'FAILED', operation: 'image-refine', parentJobId: previous.id, input: result, charge: { status: 'refunded', amount: 1, unit: 'processingCredits' }, error: 'Refinement could not finish. Your previous result is still available.', createdAt: new Date().toISOString() }, 202));
  await page.route('**/api/v1/jobs/previous-job', route => json(route, previous));
  await page.route('**/api/v1/uploads', route => { expect(route.request().postDataJSON()).toMatchObject({ kind: 'mask', contentType: 'image/png', inputArtifactId: 'previous-result' }); return json(route, { id: 'mask-upload', uploadUrl: `${origin}/fixture/mask-upload` }, 201); });
  await page.route('**/fixture/mask-upload', route => { maskBytes = route.request().postDataBuffer(); return route.fulfill({ status: 200 }); });
  await page.route('**/api/v1/uploads/mask-upload/complete', route => json(route, { id: 'mask-upload', status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/mask-upload', route => json(route, { id: 'mask-upload', status: 'ready', artifact: { id: 'binary-mask', role: 'mask', metadata: { kind: 'mask', contentType: 'image/png', width: 160, height: 120, byteSize: 100 }, expiresAt: expiration() } }));
  await page.route('**/api/v1/quotes', route => { expect(route.request().postDataJSON()).toEqual({ operation: 'image-refine', inputArtifactId: 'previous-result', maskArtifactId: 'binary-mask', parentJobId: 'previous-job' }); return json(route, { id: 'refinement-quote', amount: 1, unit: 'processingCredits', operation: 'image-refine', expiresAt: quoteExpiration(), expectedOutput: { format: 'JPG', contentType: 'image/jpeg', width: 160, height: 120 } }); });
  await page.goto('/app/image?job=previous-job');
  await page.getByRole('button', { name: 'Refine remaining marks' }).click();
  await expect(page.getByRole('button', { name: 'Review refinement cost' })).toBeDisabled();
  const canvas = page.getByLabel('Watermark refinement selection'); const box = await canvas.boundingBox(); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .3); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * .6, box!.y + box!.height * .5, { steps: 4 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Review refinement cost' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const pixels = await sharp(maskBytes!).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); expect(pixels.info).toMatchObject({ width: 160, height: 120 });
  const values = new Set<number>(); let opaqueBinary = true;
  for (let index = 0; index < pixels.data.length; index += 4) { const value = pixels.data[index]; values.add(value); if (pixels.data[index + 1] !== value || pixels.data[index + 2] !== value || pixels.data[index + 3] !== 255 || value !== 0 && value !== 255) opaqueBinary = false; }
  expect(opaqueBinary).toBe(true); expect([...values].sort()).toEqual([0, 255]);
  await page.getByRole('button', { name: 'Confirm & process · 1' }).click();
  await expect(page.getByText('Your reserved credits were returned.')).toBeVisible();
  await page.locator('.workspace-recent button').filter({ hasText: 'Ready to review' }).click();
  await expect(page.getByRole('button', { name: 'Download JPG', exact: true })).toBeVisible();
});

test('video fixed-area processing confirms its cost and produces synchronized, downloadable MP4 media', async ({ page }) => {
  await account(page);
  const video = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));
  const metadata = { kind: 'video', contentType: 'video/mp4', byteSize: video.length, width: 160, height: 90, durationSeconds: 2, fps: 24, hasAudio: true };
  const input = { id: 'video-input', role: 'input', metadata, previewUrl: `${origin}/fixture/original.mp4`, expiresAt: expiration() };
  const result = { id: 'video-result', role: 'result', metadata, previewUrl: `${origin}/fixture/result.mp4`, expiresAt: expiration(), canRefine: false };
  const job = { id: 'video-job', operation: 'video-watermark', status: 'READY', input, result, charge: { status: 'consumed', amount: 1, unit: 'processingCredits' }, createdAt: new Date().toISOString() };
  let maskBytes: Buffer | null = null; let submissions = 0;
  await page.route('**/fixture/*.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: video, headers: route.request().url().endsWith('download.mp4') ? { 'Content-Disposition': 'attachment; filename="watermark-removed-video.mp4"' } : {} }));
  await page.route('**/api/v1/uploads', route => { const payload = route.request().postDataJSON() as { kind: string }; return json(route, { id: payload.kind === 'mask' ? 'video-mask-upload' : 'video-upload', uploadUrl: `${origin}/fixture/${payload.kind}-upload` }, 201); });
  await page.route('**/fixture/video-upload', route => route.fulfill({ status: 200 }));
  await page.route('**/fixture/mask-upload', route => { maskBytes = route.request().postDataBuffer(); return route.fulfill({ status: 200 }); });
  await page.route('**/api/v1/uploads/*/complete', route => json(route, { id: 'upload', status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/video-upload', route => json(route, { id: 'video-upload', status: 'ready', artifact: input }));
  await page.route('**/api/v1/uploads/video-mask-upload', route => json(route, { id: 'video-mask-upload', status: 'ready', artifact: { id: 'video-mask', role: 'mask', metadata: { kind: 'mask', contentType: 'image/png', width: 160, height: 90, byteSize: 100 }, expiresAt: expiration() } }));
  await page.route('**/api/v1/quotes', route => { expect(route.request().postDataJSON()).toEqual({ operation: 'video-watermark', inputArtifactId: 'video-input', maskArtifactId: 'video-mask' }); return json(route, { id: 'video-quote', operation: 'video-watermark', amount: 1, unit: 'processingCredits', expiresAt: quoteExpiration(), expectedOutput: { contentType: 'video/mp4', format: 'MP4', width: 160, height: 90, durationSeconds: 2 } }); });
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; return json(route, { ...job, status: 'PROCESSING', result: undefined, progress: .5 }, 202); });
  await page.route('**/api/v1/jobs/video-job', route => json(route, job));
  downloadFiles.set('/video.mp4', { contentType: 'video/mp4', name: 'watermark-removed-video.mp4', bytes: video });
  await page.route('**/api/v1/jobs/video-job/download', route => json(route, { url: `${downloadOrigin}/video.mp4`, expiresAt: quoteExpiration() }));
  await page.goto('/app/video');
  await page.getByLabel('Upload video to workspace').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: video });
  await page.getByRole('button', { name: 'Upload & check file' }).click();
  await expect(page.getByText('File checked', { exact: true })).toBeVisible();
  await page.getByLabel('Fixed area', { exact: false }).check();
  const stage = page.locator('.workspace-video-stage'); const box = await stage.boundingBox(); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .65, box!.y + box!.height * .1); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * .9, box!.y + box!.height * .3, { steps: 4 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Review processing cost' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 processing credit'); expect(submissions).toBe(0);
  const maskMetadata = await sharp(maskBytes!).metadata(); expect(maskMetadata).toMatchObject({ width: 160, height: 90, format: 'png' });
  await page.getByRole('button', { name: 'Confirm & process · 1' }).click();
  await expect(page.getByRole('button', { name: 'Download video', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.workspace-video-comparison video')).toHaveCount(2);
  await page.getByLabel('Video playback position').focus();
  await page.getByLabel('Video playback position').press('Home');
  for (let step = 0; step < 10; step += 1) await page.getByLabel('Video playback position').press('ArrowRight');
  const positions = await page.locator('.workspace-video-comparison video').evaluateAll(elements => elements.map(element => (element as HTMLVideoElement).currentTime));
  expect(Math.abs(positions[0] - positions[1])).toBeLessThan(.15);
  await page.getByRole('button', { name: 'Play videos' }).click();
  await expect.poll(async () => page.locator('.workspace-video-comparison video').evaluateAll(elements => elements.every(element => !(element as HTMLVideoElement).paused))).toBe(true);
  await page.getByRole('button', { name: 'Pause videos' }).click();
  const pendingDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download video', exact: true }).click();
  const download = await pendingDownload; const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).equals(video)).toBe(true); expect(submissions).toBe(1);
});

test('an admitted request returning HTTP 408 restores the same confirmation after refresh', async ({ page }) => {
  await account(page);
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#e8c991' } }).jpeg().toBuffer();
  const input = { id: 'recover-input', role: 'input', metadata: { kind: 'image', contentType: 'image/jpeg', width: 80, height: 60, byteSize: image.length }, previewUrl: `${origin}/fixture/recover.jpg`, expiresAt: expiration() };
  let balance = 1; const confirmations: Array<{ quoteId: string; idempotencyKey: string }> = [];
  await page.route('**/api/v1/me', route => json(route, { freeUses: balance, processingCredits: 0 }));
  await page.route('**/fixture/recover.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: image }));
  await page.route('**/fixture/recover-upload', route => route.fulfill({ status: 200 }));
  await page.route('**/api/v1/uploads', route => json(route, { id: 'recover-upload', uploadUrl: `${origin}/fixture/recover-upload` }, 201));
  await page.route('**/api/v1/uploads/recover-upload/complete', route => json(route, { id: 'recover-upload', status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/recover-upload', route => json(route, { id: 'recover-upload', status: 'ready', artifact: input }));
  await page.route('**/api/v1/quotes', route => json(route, { id: 'recover-quote', operation: 'image-watermark', amount: 1, unit: 'freeUses', expiresAt: quoteExpiration(), expectedOutput: { contentType: 'image/jpeg', format: 'JPG', width: 80, height: 60 } }));
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() === 'GET') return json(route, { jobs: [] });
    confirmations.push(route.request().postDataJSON() as { quoteId: string; idempotencyKey: string });
    if (confirmations.length === 1) { balance = 0; return json(route, { error: 'Confirmation timed out after admission.', code: 'REQUEST_TIMEOUT' }, 408); }
    return json(route, { id: 'recovered-job', operation: 'image-watermark', status: 'UNKNOWN', input, charge: { status: 'reserved', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() }, 202);
  });
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'recover.jpg', mimeType: 'image/jpeg', buffer: image });
  await page.getByRole('button', { name: 'Upload & check file' }).click(); await page.getByRole('button', { name: 'Review processing cost' }).click();
  await page.getByRole('button', { name: 'Confirm & process · 1' }).click();
  await expect(page.getByRole('button', { name: 'Check submission' })).toBeEnabled();
  await page.reload(); await expect(page.getByRole('button', { name: 'Check submission' })).toBeEnabled();
  await expect(page.getByRole('dialog')).toContainText('0 free image uses');
  await page.getByRole('button', { name: 'Check submission' }).click();
  await expect(page).toHaveURL(/job=recovered-job/);
  expect(confirmations).toHaveLength(2); expect(confirmations[1]).toEqual(confirmations[0]);
});
