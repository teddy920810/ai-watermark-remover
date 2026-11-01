import { expect, test, type Browser, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { PrivateMediaStore, mediaKey } from '../../src/lib/runtime/private-media-store';
import { PublicProcessingProjection } from '../../src/lib/runtime/public-projection';
import type { ProcessingArtifact, ProcessingJob, ProcessingOperation } from '../../src/lib/processing/contracts';

const scenarios: Array<{ operation: ProcessingOperation; contentType: string; filename: string }> = [
  { operation: 'image-watermark', contentType: 'image/jpeg', filename: 'cleaned-image.jpg' },
  { operation: 'image-watermark-pro', contentType: 'image/jpeg', filename: 'cleaned-image.jpg' },
  { operation: 'image-refine', contentType: 'image/jpeg', filename: 'cleaned-image.jpg' },
  { operation: 'background-removal', contentType: 'image/png', filename: 'background-removed-image.png' },
  { operation: 'object-removal', contentType: 'image/png', filename: 'object-removed-image.png' },
  { operation: 'video-watermark', contentType: 'video/mp4', filename: 'cleaned-video.mp4' },
];
let server: Server; let origin: string; let media: PrivateMediaStore;
const bytes = new Map<string, Buffer>();
test.beforeAll(async () => {
  bytes.set('image/jpeg', await sharp({ create: { width: 80, height: 60, channels: 3, background: '#5577aa' } }).jpeg().toBuffer());
  bytes.set('image/png', await sharp({ create: { width: 80, height: 60, channels: 4, background: '#5577aa00' } }).png().toBuffer());
  bytes.set('video/mp4', readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url)));
  // Mimic S3 response overrides using the actual SDK signature generated below.
  // Production R2 headers require a separate retained-artifact check.
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const type = url.pathname.endsWith('.mp4') ? 'video/mp4' : url.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const body = bytes.get(type)!;
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*',
      ...(url.searchParams.has('response-content-disposition') ? { 'Content-Disposition': url.searchParams.get('response-content-disposition')! } : {}) });
    response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Download server failed');
  origin = `http://127.0.0.1:${address.port}`;
  media = new PrivateMediaStore({ bucket: 'fixture', client: new S3Client({ region: 'auto', endpoint: origin, forcePathStyle: true,
    credentials: { accessKeyId: 'fixture-key', secretAccessKey: 'fixture-secret' } }) });
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve())); });

async function normalSave(page: Page, browser: Browser, directory: string, click: () => Promise<void>) {
  mkdirSync(directory, { recursive: true });
  const pageCdp = await page.context().newCDPSession(page);
  const { targetInfo } = await pageCdp.send('Target.getTargetInfo');
  const browserCdp = await browser.newBrowserCDPSession();
  // Playwright's allowAndName mode stores GUIDs. Check ordinary on-disk names in
  // this disposable test context too; never change the user's browser settings.
  // https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-setDownloadBehavior
  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', browserContextId: targetInfo.browserContextId, downloadPath: directory, eventsEnabled: true });
  let filename = '';
  browserCdp.on('Browser.downloadWillBegin', event => { filename = event.suggestedFilename; });
  let timer: ReturnType<typeof setTimeout>;
  const completed = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Normal browser download did not complete')), 15_000);
    browserCdp.on('Browser.downloadProgress', event => {
      if (event.state === 'completed') resolve();
      if (event.state === 'canceled') reject(new Error('Normal browser download was canceled'));
    });
  });
  try { await click(); await completed; return { filename, bytes: readFileSync(path.join(directory, filename)) }; }
  finally { clearTimeout(timer!); await browserCdp.detach(); await pageCdp.detach(); }
}

async function restore(page: Page, scenario: typeof scenarios[number]) {
  const now = new Date().toISOString(); const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const video = scenario.contentType === 'video/mp4'; const data = bytes.get(scenario.contentType)!;
  const artifact: ProcessingArtifact = { id: 'retained-result', ownerId: 'download-owner', role: 'result', sealed: true,
    key: mediaKey('result', 'download-owner', 'retained-result', scenario.contentType), sha256: 'fixture', createdAt: now, expiresAt,
    metadata: { kind: video ? 'video' : 'image', contentType: scenario.contentType, width: video ? 160 : 80, height: video ? 90 : 60, byteSize: data.length,
      ...(video ? { durationSeconds: 2, fps: 24, hasAudio: true } : {}) } };
  const job: ProcessingJob = { id: 'retained-job', ownerId: 'download-owner', operation: scenario.operation, status: 'READY', inputArtifactId: artifact.id,
    resultArtifactId: artifact.id, chargeStatus: 'settled', createdAt: now, updatedAt: now, expiresAt,
    quote: { id: 'old-quote', ownerId: 'download-owner', operation: scenario.operation, inputArtifactId: artifact.id, amount: 1,
      unit: 'processingCredits', priceVersion: 'fixture', fingerprint: 'fixture', createdAt: now, expiresAt } };
  const projection = new PublicProcessingProjection({ media: { get: async () => artifact, head: async () => ({ byteSize: data.length,
    contentType: scenario.contentType, metadata: { 'owner-id': artifact.ownerId, 'artifact-id': artifact.id } }),
    createDownloadUrl: (key, filename, ttl) => media.createDownloadUrl(key, filename, ttl) }, signPreview: async () => `${origin}/preview.${scenario.filename.split('.').at(-1)}` });
  const publicJob = await projection.job('download-owner', job);
  let mutations = 0; let tickets = 0;
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'download-owner' }, session: { id: 'fixture-session' } } }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { mutations++; return route.fulfill({ status: 500, json: { error: 'Downloads must not create work' } }); }
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { operations: scenarios.map(item => ({ operation: item.operation, enabled: true })) } });
    if (path.endsWith('/me')) return route.fulfill({ json: { freeUses: 1, purchasedImageCredits: 10, processingCredits: 20 } });
    if (path.endsWith('/download')) {
      tickets++; const ticket = await projection.download('download-owner', job);
      const response = await page.request.get(ticket.url);
      expect(response.headers()['content-disposition']).toBe(`attachment; filename="${scenario.filename}"`);
      expect(response.headers()['content-type']).toBe(scenario.contentType);
      await response.dispose();
      return route.fulfill({ json: ticket });
    }
    if (path.endsWith('/jobs')) return route.fulfill({ json: { jobs: [publicJob] } });
    return route.fulfill({ json: publicJob });
  });
  await page.goto(`/app/${video ? 'video' : 'image'}?job=${job.id}`);
  return { data, counts: () => ({ mutations, tickets }) };
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  for (const scenario of scenarios) test(`${viewport.name}: restored ${scenario.operation} keeps the natural suffix across refreshed tickets`, async ({ page, browser }, testInfo) => {
    await page.setViewportSize(viewport); const state = await restore(page, scenario);
    const button = page.getByRole('button', { name: scenario.contentType === 'video/mp4' ? 'Download video' : scenario.contentType === 'image/png' ? 'Download PNG' : 'Download JPG', exact: true });
    await expect(button).toBeVisible();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) { await page.reload(); await expect(button).toBeVisible(); await page.getByRole('button', { name: 'Refresh preview link' }).click(); }
      if (attempt === 0) {
        const pending = page.waitForEvent('download'); await button.click(); const download = await pending;
        // Inspect the browser's name before touching bytes; saveAs would hide a missing suffix.
        expect(download.suggestedFilename()).toBe(scenario.filename);
        expect(await download.failure()).toBeNull();
        expect(readFileSync((await download.path())!).equals(state.data)).toBe(true);
      } else {
        const saved = await normalSave(page, browser, testInfo.outputPath('normal-save'), () => button.click());
        expect(saved.filename).toBe(scenario.filename); expect(saved.bytes.equals(state.data)).toBe(true);
      }
    }
    expect(state.counts()).toEqual({ mutations: 0, tickets: 2 });
  });
  test(`${viewport.name}: local white background export naturally saves a PNG without another task`, async ({ page, browser }, testInfo) => {
    await page.setViewportSize(viewport); const state = await restore(page, scenarios[3]!);
    await page.getByRole('button', { name: 'White background', exact: true }).click();
    const saved = await normalSave(page, browser, testInfo.outputPath('normal-save'), () => page.getByRole('button', { name: 'Download PNG', exact: true }).click());
    expect(saved.filename).toBe('background-removed-image.png');
    const data = saved.bytes;
    expect(await sharp(data).metadata()).toMatchObject({ format: 'png', width: 80, height: 60 });
    expect([...(await sharp(data).ensureAlpha().raw().toBuffer()).subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(state.counts()).toEqual({ mutations: 0, tickets: 1 });
  });
}
