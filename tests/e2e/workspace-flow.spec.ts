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
async function imageUploadFixture(page: Page) {
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#c9b07b' } }).jpeg().toBuffer();
  const artifact = { id: 'automatic-input', role: 'input', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: image.length, width: 80, height: 60 }, previewUrl: `${origin}/fixture/automatic.jpg`, expiresAt: expiration() };
  await page.route('**/fixture/automatic.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: image }));
  await page.route('**/fixture/automatic-upload', route => route.fulfill({ status: 200 }));
  await page.route('**/api/v1/uploads', route => json(route, { id: 'automatic-upload', uploadUrl: `${origin}/fixture/automatic-upload` }, 201));
  await page.route('**/api/v1/uploads/automatic-upload/complete', route => json(route, { id: 'automatic-upload', status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/automatic-upload', route => json(route, { id: 'automatic-upload', status: 'ready', artifact }));
  return { image, artifact };
}
function imageQuote(id: string, operation = 'image-watermark', amount = 1, unit = 'freeUses', expiresAt = quoteExpiration()) {
  return { id, operation, amount, unit, expiresAt, expectedOutput: { contentType: 'image/jpeg', format: 'JPG', width: 80, height: 60 } };
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
  await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('my-product.png', { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(processingRequests).toBe(0);
});

for (const scenario of [
  { name: 'image removal', operation: 'image-watermark', amount: 1, unit: 'freeUses', cost: '1 free image use', canRefine: true },
  { name: 'PRO image removal', operation: 'image-watermark-pro', amount: 3, unit: 'processingCredits', cost: '3 processing credits', canRefine: false },
] as const) test(`${scenario.name} automatically checks and prices the file, processes once, and downloads a real artifact`, async ({ page }) => {
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
  await page.route('**/api/v1/quotes', route => {
    quotes += 1; const { operation } = route.request().postDataJSON() as { operation: string };
    expect(['image-watermark', scenario.operation]).toContain(operation);
    return json(route, operation === scenario.operation ? quote : { ...quote, id: 'unused-standard-quote', operation, amount: 1, unit: 'freeUses' });
  });
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; expect(route.request().postDataJSON()).toMatchObject({ quoteId: 'quote-image', idempotencyKey: expect.any(String) }); return json(route, { ...job, status: 'QUEUED', result: undefined, charge: { ...job.charge, status: 'reserved' } }, 202); });
  await page.route('**/api/v1/jobs/job-image', route => json(route, job));
  downloadFiles.set('/image.jpg', { contentType: 'image/jpeg', name: 'watermark-removed-image.jpg', bytes: resultBytes });
  await page.route('**/api/v1/jobs/job-image/download', route => { downloads += 1; return json(route, { url: `${downloadOrigin}/image.jpg`, expiresAt: quoteExpiration() }); });
  await page.goto('/app/image');
  await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: image });
  if (scenario.operation === 'image-watermark-pro') await page.getByRole('radio', { name: /^PRO/ }).check();
  const process = page.getByRole('button', { name: `Remove watermarks · ${scenario.cost}`, exact: true });
  await expect(process).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Upload & check file', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review processing cost', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(submissions).toBe(0);
  // Reentrant activation must still create exactly one paid task.
  await process.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
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
  expect(submissions).toBe(1); expect(quotes).toBeGreaterThanOrEqual(1); expect(downloads).toBe(1);
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
  await expect(page.getByRole('button', { name: /^Remove watermarks/ })).toHaveCount(0);
  await expect(page.getByText('credits returned', { exact: false })).toHaveCount(0);
});

test('an unstarted task timeout returns the allowance and never starts a paid retry automatically', async ({ page }) => {
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
  await expect(page.locator('.workspace-balances').getByText('0 free image uses', { exact: true })).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText('Your reserved credits were returned.', { exact: true })).toBeVisible();
  await expect(page.getByText('1 free image uses', { exact: true })).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true })).toBeEnabled();
  expect(submissions).toBe(0); expect(quotes).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await page.clock.fastForward(1000);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(submissions).toBe(0);
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
  await expect(page.getByRole('button', { name: 'Refine image', exact: true })).toBeDisabled();
  const canvas = page.getByLabel('Watermark refinement selection'); const box = await canvas.boundingBox(); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .3); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * .6, box!.y + box!.height * .5, { steps: 4 }); await page.mouse.up();
  const refine = page.getByRole('button', { name: 'Refine image · 1 processing credit', exact: true });
  await expect(refine).toBeEnabled(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const pixels = await sharp(maskBytes!).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); expect(pixels.info).toMatchObject({ width: 160, height: 120 });
  const values = new Set<number>(); let opaqueBinary = true;
  for (let index = 0; index < pixels.data.length; index += 4) { const value = pixels.data[index]; values.add(value); if (pixels.data[index + 1] !== value || pixels.data[index + 2] !== value || pixels.data[index + 3] !== 255 || value !== 0 && value !== 255) opaqueBinary = false; }
  expect(opaqueBinary).toBe(true); expect([...values].sort()).toEqual([0, 255]);
  await refine.click();
  await expect(page.getByText('Your reserved credits were returned.')).toBeVisible();
  await page.locator('.workspace-recent button').filter({ hasText: 'Ready to review' }).click();
  await expect(page.getByRole('button', { name: 'Download JPG', exact: true })).toBeVisible();
});

test('video fixed-area processing prices automatically and produces synchronized, downloadable MP4 media', async ({ page }) => {
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
  await page.route('**/api/v1/quotes', route => {
    const payload = route.request().postDataJSON() as { maskArtifactId?: string };
    expect(payload).toEqual({ operation: 'video-watermark', inputArtifactId: 'video-input', ...(payload.maskArtifactId ? { maskArtifactId: 'video-mask' } : {}) });
    return json(route, { id: payload.maskArtifactId ? 'video-quote' : 'unused-automatic-video-quote', operation: 'video-watermark', amount: 1, unit: 'processingCredits', expiresAt: quoteExpiration(), expectedOutput: { contentType: 'video/mp4', format: 'MP4', width: 160, height: 90, durationSeconds: 2 } });
  });
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; expect(route.request().postDataJSON()).toMatchObject({ quoteId: 'video-quote', idempotencyKey: expect.any(String) }); return json(route, { ...job, status: 'PROCESSING', result: undefined, progress: .5 }, 202); });
  await page.route('**/api/v1/jobs/video-job', route => json(route, job));
  downloadFiles.set('/video.mp4', { contentType: 'video/mp4', name: 'watermark-removed-video.mp4', bytes: video });
  await page.route('**/api/v1/jobs/video-job/download', route => json(route, { url: `${downloadOrigin}/video.mp4`, expiresAt: quoteExpiration() }));
  await page.goto('/app/video');
  await page.getByLabel('Upload video to workspace').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: video });
  await page.getByLabel('Fixed area', { exact: false }).check();
  const stage = page.locator('.workspace-video-stage'); const box = await stage.boundingBox(); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .65, box!.y + box!.height * .1); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * .9, box!.y + box!.height * .3, { steps: 4 }); await page.mouse.up();
  const process = page.getByRole('button', { name: 'Remove watermarks · 1 processing credit', exact: true });
  await expect(process).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(submissions).toBe(0);
  const maskMetadata = await sharp(maskBytes!).metadata(); expect(maskMetadata).toMatchObject({ width: 160, height: 90, format: 'png' });
  await process.click();
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
  await page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check submission' })).toBeEnabled();
  await page.reload(); await expect(page.getByRole('button', { name: 'Check submission' })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workspace-balances').getByText('0 free image uses', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check submission' }).click();
  await expect(page).toHaveURL(/job=recovered-job/);
  expect(confirmations).toHaveLength(2); expect(confirmations[1]).toEqual(confirmations[0]);
});

test('a late cost response cannot overwrite the selected cleanup mode or submit the old quote', async ({ page }) => {
  await account(page); const { image, artifact } = await imageUploadFixture(page);
  let releaseFirst: (() => void) | undefined; let oldResponseDelivered = false;
  const operations: string[] = []; const submissions: Array<{ quoteId: string }> = [];
  await page.route('**/api/v1/quotes', async route => {
    const { operation } = route.request().postDataJSON() as { operation: string }; operations.push(operation);
    if (operation === 'image-watermark') {
      await new Promise<void>(resolve => { releaseFirst = resolve; });
      await json(route, imageQuote('old-standard')); oldResponseDelivered = true;
    } else await json(route, imageQuote('current-pro', operation, 3, 'processingCredits'));
  });
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() === 'GET') return json(route, { jobs: [] });
    submissions.push(route.request().postDataJSON() as { quoteId: string });
    return json(route, { id: 'mode-job', status: 'UNKNOWN', operation: 'image-watermark-pro', input: artifact, charge: { status: 'reserved', amount: 3, unit: 'processingCredits' }, createdAt: new Date().toISOString() }, 202);
  });
  await page.route('**/api/v1/jobs/mode-job', route => json(route, { id: 'mode-job', status: 'UNKNOWN', operation: 'image-watermark-pro', input: artifact, charge: { status: 'reserved', amount: 3, unit: 'processingCredits' }, createdAt: new Date().toISOString() }));
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'mode.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect.poll(() => operations).toEqual(['image-watermark']);
  await page.getByRole('radio', { name: /^PRO/ }).check();
  const process = page.getByRole('button', { name: 'Remove watermarks · 3 processing credits', exact: true });
  await expect(process).toBeEnabled(); expect(submissions).toHaveLength(0);
  releaseFirst?.(); await expect.poll(() => oldResponseDelivered).toBe(true);
  await expect(process).toBeEnabled(); await expect(page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true })).toHaveCount(0);
  await process.click(); await expect.poll(() => submissions).toEqual([{ quoteId: 'current-pro', idempotencyKey: expect.any(String) }]);
});

test('expired cost refreshes automatically without creating a task or charging the new amount', async ({ page }) => {
  await account(page); const { image } = await imageUploadFixture(page); await page.clock.install();
  let quotes = 0; let submissions = 0;
  await page.route('**/api/v1/quotes', route => {
    quotes += 1;
    return json(route, imageQuote(`expiry-quote-${quotes}`, 'image-watermark', quotes === 1 ? 1 : 2, 'freeUses', quotes === 1 ? new Date(Date.now() + 2000).toISOString() : quoteExpiration()));
  });
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; return json(route, { error: 'A task requires a deliberate click.' }, 409); });
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'expiry.jpg', mimeType: 'image/jpeg', buffer: image });
  await page.clock.fastForward(1000);
  await expect(page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true })).toBeEnabled();
  await page.clock.fastForward(4000);
  await expect(page.getByRole('button', { name: 'Remove watermarks · 2 free image uses', exact: true })).toBeDisabled();
  await expect(page.getByText(/not have enough free image uses/i)).toBeVisible();
  expect(quotes).toBe(2); expect(submissions).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('insufficient balance shows the full processing cost inline and never submits', async ({ page }) => {
  await account(page); const { image } = await imageUploadFixture(page);
  await page.route('**/api/v1/me', route => json(route, { freeUses: 0, processingCredits: 0 }));
  let submissions = 0;
  await page.route('**/api/v1/quotes', route => json(route, imageQuote('no-balance')));
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; return json(route, { error: 'Insufficient balance.' }, 409); });
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'balance.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true })).toBeDisabled();
  await expect(page.getByText(/not have enough free image uses/i)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(submissions).toBe(0);
});

test('a restored anonymous draft prepares itself after sign-in without starting processing', async ({ page }) => {
  await account(page, false); const { image } = await imageUploadFixture(page); let signedIn = false;
  let uploads = 0; let quotes = 0; let submissions = 0;
  await page.route('**/api/auth/get-session', route => json(route, signedIn ? { user: { id: 'workspace-test-user', name: 'Test user' }, session: { id: 'workspace-session' } } : null));
  page.on('request', request => { if (request.method() !== 'POST') return; if (request.url().endsWith('/api/v1/uploads')) uploads += 1; if (request.url().endsWith('/api/v1/quotes')) quotes += 1; if (request.url().endsWith('/api/v1/jobs')) submissions += 1; });
  await page.route('**/api/v1/quotes', route => json(route, imageQuote('signed-in-quote')));
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'keep-my-draft.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  expect(uploads).toBe(0); expect(quotes).toBe(0); expect(submissions).toBe(0);
  signedIn = true; await page.reload();
  await expect(page.getByText('keep-my-draft.jpg', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true })).toBeEnabled();
  expect(uploads).toBe(1); expect(quotes).toBe(1); expect(submissions).toBe(0);
});

test('replacing a file ignores its pending old quote and uses the newly checked file', async ({ page }) => {
  await account(page); const { image, artifact } = await imageUploadFixture(page);
  let uploads = 0; let releaseOld: (() => void) | undefined; let oldDelivered = false; const quotedInputs: string[] = []; const submitted: Array<{ quoteId: string }> = [];
  await page.route('**/api/v1/uploads', route => { uploads += 1; return json(route, { id: `replace-upload-${uploads}`, uploadUrl: `${origin}/fixture/automatic-upload` }, 201); });
  await page.route('**/api/v1/uploads/replace-upload-*/complete', route => json(route, { status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/replace-upload-*', route => { const id = route.request().url().split('/').at(-1)!; return json(route, { id, status: 'ready', artifact: { ...artifact, id: id.replace('upload', 'input') } }); });
  await page.route('**/api/v1/quotes', async route => {
    const { inputArtifactId } = route.request().postDataJSON() as { inputArtifactId: string }; quotedInputs.push(inputArtifactId);
    if (inputArtifactId === 'replace-input-1') { await new Promise<void>(resolve => { releaseOld = resolve; }); await json(route, imageQuote('old-file-quote')); oldDelivered = true; }
    else await json(route, imageQuote('new-file-quote'));
  });
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() === 'GET') return json(route, { jobs: [] });
    submitted.push(route.request().postDataJSON() as { quoteId: string });
    return json(route, { id: 'replace-job', status: 'UNKNOWN', operation: 'image-watermark', input: { ...artifact, id: 'replace-input-2' }, charge: { status: 'reserved', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() }, 202);
  });
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect.poll(() => quotedInputs).toEqual(['replace-input-1']);
  await expect(page.getByRole('button', { name: 'Replace image', exact: true })).toBeEnabled();
  await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: image });
  const process = page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true }); await expect(process).toBeEnabled();
  await expect(page.getByText('replacement.jpg', { exact: true })).toBeVisible(); expect(quotedInputs).toEqual(['replace-input-1', 'replace-input-2']);
  releaseOld?.(); await expect.poll(() => oldDelivered).toBe(true); await expect(process).toBeEnabled(); expect(submitted).toHaveLength(0);
  await process.click(); await expect.poll(() => submitted).toEqual([{ quoteId: 'new-file-quote', idempotencyKey: expect.any(String) }]);
});

test('a corrupt replacement keeps the valid file usable and restores its processing cost', async ({ page }) => {
  await account(page); const { image } = await imageUploadFixture(page); let submissions = 0;
  await page.route('**/api/v1/quotes', route => json(route, imageQuote('valid-file-quote')));
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [] }); submissions += 1; return json(route, { error: 'Processing requires a deliberate click.' }, 409); });
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'valid-product.jpg', mimeType: 'image/jpeg', buffer: image });
  const process = page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true }); await expect(process).toBeEnabled();
  await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'corrupt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('This is not a decodable JPEG.') });
  await expect(page.getByText('This image could not be opened. Choose another JPG, PNG, or WebP.', { exact: true })).toBeVisible();
  await expect(page.getByText('valid-product.jpg', { exact: true })).toBeVisible();
  await expect(process).toBeEnabled(); expect(submissions).toBe(0);
});

test('a corrupt replacement during file checking resumes the same valid upload automatically', async ({ page }) => {
  await account(page); const { image, artifact } = await imageUploadFixture(page);
  let checks = 0; let uploads = 0; let submissions = 0; let replacementChosen = false;
  page.on('request', request => { if (request.method() !== 'POST') return; if (request.url().endsWith('/api/v1/uploads')) uploads += 1; if (request.url().endsWith('/api/v1/jobs')) submissions += 1; });
  await page.route('**/api/v1/uploads/automatic-upload', route => { checks += 1; return json(route, !replacementChosen ? { id: 'automatic-upload', status: 'validating' } : { id: 'automatic-upload', status: 'ready', artifact }); });
  await page.route('**/api/v1/quotes', route => json(route, imageQuote('resumed-valid-file-quote')));
  await page.goto('/app/image'); await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'checking-product.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect.poll(() => checks).toBeGreaterThan(0); replacementChosen = true;
  await page.getByLabel('Upload image to workspace').setInputFiles({ name: 'corrupt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('This is not a decodable JPEG.') });
  await expect(page.getByText('This image could not be opened. Choose another JPG, PNG, or WebP.', { exact: true })).toBeVisible();
  await expect(page.getByText('checking-product.jpg', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove watermarks · 1 free image use', exact: true })).toBeEnabled();
  expect(uploads).toBe(1); expect(submissions).toBe(0);
});

test('refinement redraws replace the quoted mask while keeping one deliberate paid action', async ({ page }) => {
  await account(page); const { artifact } = await imageUploadFixture(page);
  const previous = { id: 'redraw-parent', operation: 'image-watermark', status: 'READY', input: artifact, result: { ...artifact, id: 'redraw-result', role: 'result', canRefine: true }, charge: { status: 'consumed', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() };
  let masks = 0; let quotes = 0; const submitted: Array<{ quoteId: string }> = []; const maskContents: Buffer[] = [];
  await page.route('**/api/v1/jobs/redraw-parent', route => json(route, previous));
  await page.route('**/api/v1/jobs', route => {
    if (route.request().method() === 'GET') return json(route, { jobs: [previous] });
    submitted.push(route.request().postDataJSON() as { quoteId: string });
    return json(route, { id: 'redraw-child', operation: 'image-refine', status: 'UNKNOWN', input: previous.result, parentJobId: previous.id, charge: { status: 'reserved', amount: 1, unit: 'processingCredits' }, createdAt: new Date().toISOString() }, 202);
  });
  await page.route('**/api/v1/uploads', route => { masks += 1; return json(route, { id: `redraw-mask-${masks}`, uploadUrl: `${origin}/fixture/redraw-mask-${masks}` }, 201); });
  await page.route('**/fixture/redraw-mask-*', route => { maskContents.push(route.request().postDataBuffer()!); return route.fulfill({ status: 200 }); });
  await page.route('**/api/v1/uploads/redraw-mask-*/complete', route => json(route, { status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/redraw-mask-*', route => {
    const id = route.request().url().split('/').at(-1)!;
    return json(route, { id, status: 'ready', artifact: { id, role: 'mask', metadata: { kind: 'mask', contentType: 'image/png', width: 80, height: 60, byteSize: 100 }, expiresAt: expiration() } });
  });
  await page.route('**/api/v1/quotes', route => {
    quotes += 1;
    expect(route.request().postDataJSON()).toEqual({ operation: 'image-refine', inputArtifactId: 'redraw-result', maskArtifactId: `redraw-mask-${quotes}`, parentJobId: 'redraw-parent' });
    return json(route, imageQuote(`redraw-quote-${quotes}`, 'image-refine', 1, 'processingCredits'));
  });
  await page.goto('/app/image?job=redraw-parent'); await page.getByRole('button', { name: 'Refine remaining marks' }).click();
  const canvas = page.getByLabel('Watermark refinement selection'); const box = await canvas.boundingBox(); expect(box).toBeTruthy();
  const draw = async (x: number, y: number) => { await page.mouse.move(box!.x + box!.width * x, box!.y + box!.height * y); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * (x + .1), box!.y + box!.height * y, { steps: 3 }); await page.mouse.up(); };
  await draw(.1, .2);
  const refine = page.getByRole('button', { name: 'Refine image · 1 processing credit', exact: true }); await expect(refine).toBeEnabled(); expect(quotes).toBe(1);
  await draw(.6, .7); await expect.poll(() => quotes).toBe(2); await expect(refine).toBeEnabled();
  expect(maskContents).toHaveLength(2); expect(maskContents[0].equals(maskContents[1])).toBe(false); expect(submitted).toHaveLength(0);
  await refine.click(); await expect.poll(() => submitted).toEqual([{ quoteId: 'redraw-quote-2', idempotencyKey: expect.any(String) }]);
});

test('undo beyond retained brush history keeps the remaining selection processable', async ({ page }) => {
  await account(page); const { artifact } = await imageUploadFixture(page);
  const previous = { id: 'undo-parent', operation: 'image-watermark', status: 'READY', input: artifact, result: { ...artifact, id: 'undo-result', role: 'result', canRefine: true }, charge: { status: 'consumed', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() };
  let submissions = 0; let quotes = 0;
  await page.route('**/api/v1/jobs/undo-parent', route => json(route, previous));
  await page.route('**/api/v1/jobs', route => { if (route.request().method() === 'GET') return json(route, { jobs: [previous] }); submissions += 1; return json(route, { error: 'An undo must not submit processing.' }, 409); });
  await page.route('**/api/v1/uploads', route => json(route, { id: 'undo-mask-upload', uploadUrl: `${origin}/fixture/undo-mask-upload` }, 201));
  await page.route('**/fixture/undo-mask-upload', route => route.fulfill({ status: 200 }));
  await page.route('**/api/v1/uploads/undo-mask-upload/complete', route => json(route, { status: 'validating' }, 202));
  await page.route('**/api/v1/uploads/undo-mask-upload', route => json(route, { id: 'undo-mask-upload', status: 'ready', artifact: { id: 'undo-mask', role: 'mask', metadata: { kind: 'mask', contentType: 'image/png', width: 80, height: 60, byteSize: 100 }, expiresAt: expiration() } }));
  await page.route('**/api/v1/quotes', route => { quotes += 1; return json(route, imageQuote(`undo-quote-${quotes}`, 'image-refine', 1, 'processingCredits')); });
  await page.goto('/app/image?job=undo-parent'); await page.getByRole('button', { name: 'Refine remaining marks' }).click();
  const canvas = page.getByLabel('Watermark refinement selection'); const box = await canvas.boundingBox(); expect(box).toBeTruthy();
  for (let stroke = 0; stroke < 9; stroke += 1) {
    await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .3); await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * .4, box!.y + box!.height * .4, { steps: 2 }); await page.mouse.up();
  }
  const refine = page.getByRole('button', { name: 'Refine image · 1 processing credit', exact: true }); await expect(refine).toBeEnabled();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  for (let step = 0; step < 8; step += 1) await undo.click();
  await expect(refine).toBeEnabled();
  // The eight saved states are exhausted, but the earliest stroke is still selected.
  await undo.click(); await expect(refine).toBeEnabled(); expect(submissions).toBe(0);
});
