import { openWorkspace, reloadWorkspace, waitForWorkspace } from '../helpers/workspace';
import { imageOperationFixture } from '../helpers/image-operation-fixture';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

test('the product entry has a static loading shell and compatibility paths use the same shell', async ({ request, page }) => {
  const response = await request.get('/app');
  expect(response.status()).toBe(200);
  expect(response.url()).toMatch(/\/app$/);
  const html = await response.text();
  expect(html).toContain('Opening your workspace');
  expect(html).toContain('data-workspace-loading');
  expect(html).toContain('noindex');
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  for (const path of ['/app', '/app/image', '/app/video']) {
    await openWorkspace(page, path);
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect(page.getByLabel('Choose operation')).toBeVisible();
    await expect(page.locator('main h1')).toHaveCount(1);
  }
});

test('a saved task determines its media at the common entry ahead of a new operation hint', async ({ page }) => {
  const video = readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));
  const artifact = { id: 'old-video-input', role: 'input', previewUrl: '/saved-video.mp4', metadata: { kind: 'video', contentType: 'video/mp4', byteSize: video.length, width: 160, height: 90, durationSeconds: 2, fps: 24, hasAudio: true }, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const job = { id: 'saved-video-task', operation: 'video-watermark', status: 'PROCESSING', input: artifact, charge: { status: 'reserved', amount: 1, unit: 'processingCredits' }, createdAt: new Date().toISOString() };
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'video-owner' }, session: { id: 'video-session' } } }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  await page.route('**/api/v1/me', route => route.fulfill({ json: { freeUses: 1, purchasedImageCredits: 0, processingCredits: 5 } }));
  await page.route('**/api/v1/jobs', route => route.fulfill({ json: { jobs: [job] } }));
  await page.route('**/api/v1/jobs/saved-video-task', route => route.fulfill({ json: job }));
  await page.route('**/saved-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: video }));
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/v1\/(?:uploads|quotes|jobs)/.test(request.url())) writes++; });
  await openWorkspace(page, '/app?operation=background-removal&job=saved-video-task');
  await expect(page.getByRole('heading', { name: 'Remove video watermarks' })).toBeVisible();
  await expect(page.getByLabel('Choose operation')).toHaveValue('video-watermark');
  await expect(page.locator('.background-tool-card')).toHaveCount(0);
  await expect(page.locator('.workspace-stage-panel video').first()).toHaveJSProperty('videoWidth', 160);
  expect(writes).toBe(0);
});

test('an explicit PRO operation survives selecting a local file and reloading', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [{ operation: 'image-watermark-pro', enabled: true, acceptedTypes: ['image/png'], maxBytes: 10485760 }] } }));
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#95bbaa' } }).png().toBuffer();
  await openWorkspace(page, '/app?operation=image-watermark-pro');
  await page.getByLabel('Upload file to workspace', { exact: true }).setInputFiles({ name: 'pro-image.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByText('pro-image.png', { exact: true })).toBeVisible();
  await reloadWorkspace(page);
  await expect(page.getByLabel('Choose operation')).toHaveValue('image-watermark-pro');
});

test('an authenticated local draft does not cross accounts after a full page reload', async ({ page }) => {
  let owner = 'owner-a'; let writes = 0; let preparations = 0; let anotherOwnerPreparations = 0;
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: owner, name: owner }, session: { id: owner } } }));
  await page.route('**/api/payments/catalog', route => route.fulfill({ json: { enabled: false, creditsEnabled: false, packages: [] } }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({json:{operations:[]}}));
  await page.route('**/api/v1/uploads', route => { preparations++; if (owner === 'owner-b') anotherOwnerPreparations++; return route.fulfill({status:503,json:{error:'Offline preparation fixture'}}); });
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(?:v1\/jobs|jobs)(?:\?|$)/.test(request.url())) writes++; });
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#8599aa' } }).png().toBuffer();
  await openWorkspace(page, '/app?operation=background-removal');
  await page.getByLabel('Upload file to workspace', { exact: true }).setInputFiles({ name: 'owner-a-private.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByText('owner-a-private.png', { exact: true })).toBeVisible();
  await reloadWorkspace(page); await expect(page.getByText('owner-a-private.png', { exact: true })).toBeVisible();
  owner = 'owner-b'; await reloadWorkspace(page);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await expect(page.getByText('owner-a-private.png', { exact: true })).toHaveCount(0);
  expect(writes).toBe(0); expect(preparations).toBeGreaterThan(0); expect(anotherOwnerPreparations).toBe(0);
});

test('background and object operations open in the same App with the same anonymous local file and no billable request', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: ['image-watermark', 'background-removal', 'object-removal'].map(operation => ({ operation, enabled: true, maxBytes: 10485760 })) } }));
  await page.route('**/api/payments/catalog', route => route.fulfill({ json: { enabled: false, creditsEnabled: false, environment: 'sandbox', packages: [], imageCosts: { 'watermark-removal': 1, 'background-removal': 1, 'object-removal': 1 } } }));
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(?:v1\/(?:uploads|quotes|jobs)|upload-url|jobs)/.test(request.url())) writes++; });
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#92acba' } }).png().toBuffer();
  await page.goto('/');
  await expect(page.getByTestId('media-launcher-file')).toBeEnabled();
  await page.getByTestId('media-launcher-file').setInputFiles({ name: 'same-file.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await page.getByLabel('Choose operation').selectOption('background-removal');
  await expect(page).toHaveURL(/\/app\?operation=background-removal$/); await waitForWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Remove background', exact: true })).toBeVisible();
  await expect(page.getByText('same-file.png', { exact: true })).toBeVisible();
  await page.getByLabel('Choose operation').selectOption('object-removal');
  await expect(page.getByRole('heading', { name: 'Remove object', exact: true })).toBeVisible();
  await expect(page.getByLabel('Object removal mask canvas')).toBeVisible();
  await expect(page.getByText('same-file.png', { exact: true })).toBeVisible();
  expect(writes).toBe(0);
});

test('an operation bundle failure leaves a readable recovery action and reload can reopen the workspace', async ({ page }) => {
  let blocked = false;
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  const bundle = '**/src/components/workspace/WatermarkWorkspace.tsx*';
  await page.route(bundle, route => { blocked = true; return route.abort('failed'); });
  await page.goto('/app');
  await expect.poll(() => blocked).toBe(true);
  await expect(page.getByRole('heading', { name: 'Workspace could not open' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reload workspace' })).toBeVisible();
  await page.unroute(bundle); await reloadWorkspace(page);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
});

test('initial object sign-in retains its selection, waits for a quote and does not cross accounts', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => ({ location: { href: '' }, close() {} }) as unknown as Window; });
  await page.route('**/api/auth/sign-in/social', route => route.fulfill({json:{url:'https://accounts.google.test/fixture'}}));
  const state = await imageOperationFixture(page, { operation:'object-removal', initiallySignedIn:false });
  await page.getByRole('button',{name:'Sign in to continue',exact:true}).click(); state.signedIn=true;
  await page.evaluate(()=>{window.postMessage({type:'clearmark-auth-complete'},location.origin);window.postMessage({type:'clearmark-auth-complete'},location.origin);});
  const action=page.getByRole('button',{name:'Remove object · 10 image credits',exact:true}); await expect(action).toBeEnabled();
  expect(state.submissions).toBe(0); expect(state.masks).toHaveLength(1);
  await action.click(); await expect(page.getByRole('button',{name:'Download PNG',exact:true})).toBeVisible();
  expect(state.submissions).toBe(1); state.owner='another-owner'; state.job=null; await reloadWorkspace(page);
  await expect(page.locator('[data-app-shell]')).toBeVisible(); await expect(page.getByText('background-source.png',{exact:true})).toHaveCount(0);
  expect(state.submissions).toBe(1); expect(state.oldRequests).toBe(0);
});

test('switching same-size recent object sources clears painted pixels and undo history', async ({ page }) => {
  const image = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#95bbaa' } }).png().toBuffer();
  const jobs = ['first', 'second'].map(id => ({ id, operation: 'object-removal', status: 'FAILED', input: { id: `${id}-source`, role: 'source', previewUrl: `/fixture/${id}.png`, metadata: { kind: 'image', contentType: 'image/png', width: 160, height: 120, byteSize: image.length }, expiresAt: new Date(Date.now() + 3600000).toISOString() }, charge: { status: 'refunded', amount: 1, unit: 'freeUses' }, createdAt: new Date().toISOString() }));
  let submissions = 0;
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'mask-owner' }, session: { id: 'mask-session' } } }));
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { operations: [{ operation: 'object-removal', enabled: true, acceptedTypes: ['image/png'], maxBytes: 10485760 }] } });
    if (path.endsWith('/me')) return route.fulfill({ json: { freeUses: 2, purchasedImageCredits: 0, processingCredits: 0 } });
    if (path.endsWith('/jobs')) {
      if (route.request().method() === 'POST') submissions++;
      return route.fulfill({ json: { jobs } });
    }
    const job = jobs.find(value => path.endsWith(`/jobs/${value.id}`));
    return job ? route.fulfill({ json: job }) : route.fulfill({ status: 503, json: { error: 'Quote preparation unavailable in this selection-only test' } });
  });
  await page.route('**/fixture/*.png', route => route.fulfill({ contentType: 'image/png', body: image }));
  await openWorkspace(page, '/app?job=first');
  const canvas = page.getByLabel('Object removal mask canvas');
  await expect(canvas).toBeVisible();
  const paint = async (fraction: number) => { const box = (await canvas.boundingBox())!; await page.mouse.move(box.x + box.width * fraction, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * (fraction + .02), box.y + box.height * .5); await page.mouse.up(); };
  const paintedPixels = () => canvas.evaluate((value: HTMLCanvasElement) => value.getContext('2d')!.getImageData(0, 0, value.width, value.height).data.filter((alpha, index) => index % 4 === 3 && alpha > 0).length);
  await paint(.2);
  await expect.poll(paintedPixels).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.locator('.workspace-recent button').nth(1).click();
  await expect(page.locator('.object-editor-stage img')).toHaveAttribute('src', '/fixture/second.png');
  await expect.poll(paintedPixels).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await paint(.8);
  await expect.poll(paintedPixels).toBeGreaterThan(0);
  expect(await canvas.evaluate((value: HTMLCanvasElement) => value.getContext('2d')!.getImageData(32, 60, 1, 1).data[3])).toBe(0);
  expect(submissions).toBe(0);
});
