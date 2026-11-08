import { reloadWorkspace } from '../helpers/workspace';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { imageOperationFixture, stroke } from '../helpers/image-operation-fixture';
import { inspectPngArtifact } from '../../scripts/lib/png-artifact.mjs';

let downloads: Server; let downloadOrigin = ''; let output: Buffer;
test.beforeAll(async () => {
  output = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#5577aa00' } }).png().toBuffer();
  downloads = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': output.length, 'Content-Disposition': 'attachment; filename="background-removed-image.png"', 'Access-Control-Allow-Origin': '*' }); response.end(output);
  });
  await new Promise<void>(resolve => downloads.listen(0, '127.0.0.1', resolve));
  const address = downloads.address(); if (!address || typeof address === 'string') throw new Error('Download server failed');
  downloadOrigin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => downloads.close(error => error ? reject(error) : resolve())); });

const fixture = (page: Page, initiallySignedIn = true, purchasedImageCredits = 100, operation: 'background-removal' | 'object-removal' = 'background-removal', autoSelect = true) => imageOperationFixture(page, { initiallySignedIn, purchasedImageCredits, operation, autoSelect, output, downloadOrigin });

test('unified Credits paused admission and insufficient balance retain the file without a misleading purchase prompt', async ({ page }, testInfo) => {
  const state = await imageOperationFixture(page, { unified: true, creditsAdmissionEnabled: false, output, downloadOrigin });
  await expect(page.getByRole('button', { name: 'Remove background · 10 Credits', exact: true })).toBeDisabled();
  await expect(page.locator('.workspace-balances')).toContainText('New processing is paused');
  await page.route('**/api/v1/me', route => route.fulfill({ json: { walletMode: 'unified', unit: 'credits', credits: 0, admissionEnabled: true } }));
  await reloadWorkspace(page);
  await expect(page.getByRole('button', { name: 'Remove background · 10 Credits', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('not have enough Credits');
  await expect(page.locator('.workspace-action-block').getByRole('link', { name: 'Buy image credits', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-action-block').getByRole('link', { name: 'Credits & orders', exact: true })).toBeVisible();
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('.workspace-action-block').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`credits-insufficient-${name}.png`), animations: 'disabled', style: 'astro-dev-toolbar{visibility:hidden!important}' });
  }
  expect(state.submissions).toBe(0); expect(state.oldRequests).toBe(0);
});

for (const operation of ['background-removal', 'object-removal'] as const) test(`unified Credits ${operation} spends 10 once and downloads the original PNG format`, async ({ page }, testInfo) => {
  const state = await imageOperationFixture(page, { operation, unified: true, output, downloadOrigin });
  await expect(page.locator('.workspace-balances')).toContainText('100 Credits');
  await expect(page.getByText('Uses your shared Credits balance. Reward Credits are used first.', { exact: true })).toBeVisible();
  const label = operation === 'object-removal' ? 'Remove object' : 'Remove background';
  expect(state.submissions).toBe(0);
  await page.getByRole('button', { name: `${label} · 10 Credits`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-balances')).toContainText('90 Credits');
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const path = testInfo.outputPath(`${operation}.png`); await (await event).saveAs(path);
  expect(await inspectPngArtifact(readFileSync(path), { requireTransparency: operation === 'background-removal' })).toMatchObject({ width: 80, height: 60 });
  await reloadWorkspace(page); await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  expect(state.submissions).toBe(1); expect(state.oldRequests).toBe(0); expect(state.purchasedImageCredits).toBe(90);
});

test('background uses the common durable quote, retains transparent/color PNG downloads and restores the accepted job', async ({ page }, testInfo) => {
  const state = await fixture(page);
  expect(state.submissions).toBe(0);
  await page.getByRole('button', { name: 'Remove background · 10 image credits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByAltText('Selected image preview', { exact: true })).toHaveAttribute('src', '/fixture/durable-input.png');
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(page.getByAltText('Selected image preview', { exact: true })).toHaveAttribute('src', '/fixture/durable-result.png');
  await expect(page.locator('.custom-color-control')).toHaveCSS('padding-top', '17px');
  await expect(page.getByLabel('Custom background color')).toHaveCSS('height', '38px');
  await expect(page.locator('.preset-color-group')).toHaveCSS('padding-bottom', '18px');
  await expect(page.getByText('Go to Editor', { exact: true })).toHaveCount(0);
  const transparentEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const transparent = await transparentEvent; const transparentPath = testInfo.outputPath('transparent.png'); await transparent.saveAs(transparentPath);
  expect(await sharp(readFileSync(transparentPath)).metadata()).toMatchObject({ format: 'png', width: 80, height: 60, hasAlpha: true });
  await expect(inspectPngArtifact(readFileSync(transparentPath), { requireTransparency: true })).resolves.toMatchObject({ width: 80, height: 60, hasTransparentPixel: true });
  expect((await sharp(readFileSync(transparentPath)).raw().toBuffer())[3]).toBe(0);
  await page.getByRole('button', { name: 'White background', exact: true }).click();
  await expect(page.getByRole('button', { name: 'White background', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const colorEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const colorPath = testInfo.outputPath('white.png'); await (await colorEvent).saveAs(colorPath);
  await expect(inspectPngArtifact(readFileSync(colorPath), { expectedOpaqueColor: [255, 255, 255] })).resolves.toMatchObject({ width: 80, height: 60, matchesExpectedOpaqueColor: true });
  expect([...(await sharp(readFileSync(colorPath)).raw().toBuffer()).subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Transparent background', exact: true }).click();
  for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `output/playwright/refactor-p6-background-${label}.png`, animations: 'disabled', style: 'astro-dev-toolbar{visibility:hidden!important}' });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/refactor-p6-background-controls-${label}.png`, animations: 'disabled', style: 'astro-dev-toolbar{visibility:hidden!important}' });
  }
  await reloadWorkspace(page);
  await expect(page.getByLabel('Choose operation')).toHaveValue('background-removal');
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  expect(state.submissions).toBe(1); expect(state.oldRequests).toBe(0);
});

for (const operation of ['background-removal', 'object-removal'] as const) {
const label = operation === 'object-removal' ? 'Remove object' : 'Remove background';
test(`${label} price changes require another explicit click and retain the same checked source`, async ({ page }) => {
  const state = await fixture(page, true, 100, operation); state.rejectPrice = true;
  await page.getByRole('button', { name: `${label} · 10 image credits`, exact: true }).click();
  await expect(page.getByRole('button', { name: `${label} · 15 image credits`, exact: true })).toBeEnabled();
  expect(state.submissions).toBe(1); expect(state.uploads).toBe(operation === 'object-removal' ? 2 : 1);
  await page.getByRole('button', { name: `${label} · 15 image credits`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  expect(state.submissions).toBe(2); expect(state.oldRequests).toBe(0);
});

test(`${label} UNKNOWN retains the same task without a replacement file or a fresh paid replay`, async ({ page }) => {
  const state = await fixture(page, true, 100, operation); state.unknown = true;
  await page.getByRole('button', { name: `${label} · 10 image credits`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checking the processing confirmation', exact: true })).toBeVisible();
  await expect(page.getByLabel('Choose operation')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Upload file', exact: true })).toBeDisabled();
  await reloadWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Checking the processing confirmation', exact: true })).toBeVisible();
  expect(state.submissions).toBe(1); expect(state.oldRequests).toBe(0);
});

test(`${label} sign-in retains the original file and still waits for its explicit quoted action`, async ({ page }) => {
  await page.addInitScript(() => { window.open = () => ({ location: { href: '' }, close() {} }) as unknown as Window; });
  await page.route('**/api/auth/sign-in/social', route => route.fulfill({ json: { url: 'https://accounts.google.test/fixture' } }));
  const state = await fixture(page, false, 100, operation);
  expect(state.uploads).toBe(0); expect(state.quotes).toBe(0); expect(state.submissions).toBe(0);
  await page.getByRole('button', { name: 'Sign in to continue', exact: true }).click();
  state.signedIn = true;
  await page.evaluate(() => window.postMessage({ type: 'clearmark-auth-complete' }, window.location.origin));
  await expect(page.getByRole('button', { name: `${label} · 10 image credits`, exact: true })).toBeEnabled();
  await expect(page.getByLabel('Choose operation')).toHaveValue(operation);
  expect(state.submissions).toBe(0);
  await page.getByRole('button', { name: `${label} · 10 image credits`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  expect(state.submissions).toBe(1); expect(state.oldRequests).toBe(0);
});

test(`${label} credit recovery keeps its operation return path and the selected image without submitting`, async ({ page }) => {
  const state = await fixture(page, true, 0, operation);
  await expect(page.getByRole('button', { name: `${label} · 10 image credits`, exact: true })).toBeDisabled();
  const purchase = page.locator('.workspace-action-block').getByRole('link', { name: 'Buy image credits', exact: true });
  await expect(purchase).toHaveAttribute('href', `/pricing?returnTo=${encodeURIComponent(`/app?operation=${operation}`)}`);
  await expect(purchase).toHaveAttribute('target', '_blank');
  await expect(page.getByText('background-source.png', { exact: true })).toBeVisible();
  expect(state.uploads).toBe(operation === 'object-removal' ? 2 : 1); expect(state.submissions).toBe(0); expect(state.oldRequests).toBe(0);
});

}

test('background automatically refreshes an expired preview link without creating another task', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Remove background · 10 image credits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  await page.route('**/fixture/durable-result.png?expired=1', route => route.abort());
  await page.route('**/fixture/durable-refreshed.png', route => route.fulfill({ contentType: 'image/png', body: output }));
  (state.job!.result as { previewUrl: string }).previewUrl = '/fixture/durable-refreshed.png';
  await page.getByAltText('Selected image preview', { exact: true }).evaluate(image => { (image as HTMLImageElement).src = '/fixture/durable-result.png?expired=1'; });
  await expect(page.getByAltText('Selected image preview', { exact: true })).toHaveAttribute('src', '/fixture/durable-refreshed.png');
  await expect(page.getByAltText('Selected image preview', { exact: true })).toHaveJSProperty('naturalWidth', 80);
  expect(state.submissions).toBe(1); expect(state.uploads).toBe(1); expect(state.oldRequests).toBe(0);
});


test('object uses the durable coordinator with independent tools, opaque binary selections, latest quote and PNG download', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const state = await fixture(page, true, 100, 'object-removal', false);
  await expect(page.getByRole('heading', { name: 'Remove object', exact: true })).toBeVisible();
  await expect(page.getByLabel('Object removal mask canvas')).toHaveJSProperty('width', 80);
  await expect(page.getByLabel('Object removal mask canvas')).toHaveJSProperty('height', 60);
  expect((await page.getByLabel('Object removal mask canvas').boundingBox())!.width).toBeGreaterThan(250);
  expect(state.quotes).toBe(0); await stroke(page);
  const action = page.getByRole('button', { name: 'Remove object · 10 image credits', exact: true }); await expect(action).toBeEnabled();
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  const canvas = page.getByLabel('Object removal mask canvas'); await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .2); await page.mouse.down();
  for (const [x,y] of [[.85,.2],[.85,.4],[.65,.4]]) await page.mouse.move(box.x + box.width*x, box.y + box.height*y); await page.mouse.up();
  await expect.poll(() => state.masks.length).toBe(2); await expect(action).toBeEnabled();
  expect(state.masks[0].equals(state.masks[1])).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect.poll(() => state.masks.length).toBe(3);
  expect(state.masks[2].equals(state.masks[0])).toBe(true);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click(); await stroke(page, .25, .3);
  await expect.poll(() => state.masks.length).toBe(4); await expect(action).toBeEnabled();
  for (const bytes of state.masks) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 80, height: 60, channels: 4 });
    let invalidPixels = 0;
    for (let i=0;i<data.length;i+=4) if (data[i+3] !== 255 || ![0,255].includes(data[i]) || data[i+1] !== data[i] || data[i+2] !== data[i]) invalidPixels++;
    expect(invalidPixels).toBe(0);
    expect(data.some((value,index) => index%4===0 && value===255)).toBe(true);
  }
  expect(state.quoteRequests.at(-1)?.maskArtifactId).toBe('mask-durable-upload-5');
  for (const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]] as const) {
    await page.setViewportSize({width,height}); await canvas.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path: `output/playwright/refactor-p6-object-${label}.png`, animations:'disabled',style:'astro-dev-toolbar{visibility:hidden!important}'});
  }
  await action.click(); await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'White background', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refine remaining marks', exact: true })).toHaveCount(0);
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const target=testInfo.outputPath('object-result.png'); await (await event).saveAs(target);
  expect(readFileSync(target)).toEqual(output); expect(await sharp(readFileSync(target)).metadata()).toMatchObject({format:'png',width:80,height:60});
  await reloadWorkspace(page); await expect(page.getByLabel('Choose operation')).toHaveValue('object-removal');
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeVisible();
  expect(state.submissions).toBe(1); expect(state.purchasedImageCredits).toBe(90); expect(state.oldRequests).toBe(0);
});

test('a portrait object source keeps the image and selection coordinate planes aligned on mobile', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  const state=await imageOperationFixture(page,{operation:'object-removal',autoSelect:false,dimensions:{width:80,height:240}});
  const canvas=page.getByLabel('Object removal mask canvas');await expect(canvas).toHaveJSProperty('width',80);await expect(canvas).toHaveJSProperty('height',240);
  const box=(await canvas.boundingBox())!;expect(box.width/box.height).toBeCloseTo(80/240,2);
  await expect(page.getByLabel('Brush size')).toHaveAttribute('min','10');await expect(page.getByLabel('Brush size')).toHaveAttribute('max','140');
  expect(state.submissions).toBe(0);expect(state.oldRequests).toBe(0);
});
