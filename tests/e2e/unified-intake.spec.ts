import { imageOperationFixture } from '../helpers/image-operation-fixture';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';

const video = fs.readFileSync(new URL('../fixtures/workspace-24fps.mp4', import.meta.url));
const pages = fs.readdirSync('src/content/landing-pages').filter(file => file.endsWith('.json')).map(file => JSON.parse(fs.readFileSync(`src/content/landing-pages/${file}`, 'utf8'))).filter(page => !page.draft) as Array<{ slug: string }>;
async function localOnly(page: Page) {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [{ operation: 'image-watermark', enabled: true, maxBytes: 10485760 }, { operation: 'video-watermark', enabled: true, maxBytes: 104857600 }] } }));
  await page.route('**/api/payments/catalog', route => route.fulfill({ json: { enabled: false, creditsEnabled: false, packages: [] } }));
  const writes: string[] = [];
  await page.route(/\/api\/(?:v1\/)?(?:uploads?|upload-url|quotes|jobs)(?:\/|\?|$)/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { jobs: [] } });
    writes.push(route.request().url()); return route.abort();
  });
  return writes;
}
test('every published tool and the homepage use one automatic file entry and the same footer picker', async ({ page }) => {
  test.setTimeout(180_000); const writes = await localOnly(page);
  for (const route of ['/', ...pages.map(page => `/${page.slug}`)]) {
    await page.goto(route);
    const entry = page.locator('#tool');
    await expect(entry.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
    await expect(entry.locator('input[type=file]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4');
    await expect(entry.locator('.launcher-modes,.background-tool-card,.object-tool-card')).toHaveCount(0);
    await expect(page.locator('.site-cta input[type=file]')).toHaveCount(1);
  }
  expect(writes).toEqual([]);
});
test('a background recommendation keeps its image and an incompatible video opens with a clear explanation', async ({ page }) => {
  const writes = await localOnly(page);
  await page.goto('/remove-background');
  const input = page.locator('#tool input[type=file]'); await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 80, height: 60, channels: 3, background: '#aabbaa' } }).png().toBuffer() });
  await expect(page.getByLabel('Choose operation')).toHaveValue('background-removal');
  await expect(page.getByText('original.png', { exact: true })).toBeVisible();
  await page.goto('/remove-background'); await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'original.mp4', mimeType: 'video/mp4', buffer: video });
  await expect(page.getByLabel('Choose operation')).toHaveValue('video-watermark');
  await expect(page.locator('.app-entry-notice')).toContainText(/video|compatible/i);
  await expect(page.getByText('original.mp4', { exact: true })).toBeVisible(); expect(writes).toEqual([]);
});
test('an unavailable source gives an explicit notice and the footer hands off a real local file directly', async ({ page }) => {
  const writes = await localOnly(page);
  await page.goto('/sora-watermark-remover');
  const footer = page.locator('.site-cta'); await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
  await footer.locator('input[type=file]').setInputFiles({ name: 'from-footer.mp4', mimeType: 'video/mp4', buffer: video });
  await expect(page.getByText('from-footer.mp4', { exact: true })).toBeVisible();
  await expect(page.locator('.app-entry-notice')).toContainText(/not available|not open|unavailable/i);
  expect(writes).toEqual([]);
});
test('choosing another file in App automatically switches media while keeping the original bytes local', async ({ page }) => {
  const writes = await localOnly(page);
  await page.goto('/app/image');
  const input = page.getByLabel('Upload file to workspace', { exact: true }); await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'replacement.mp4', mimeType: 'video/mp4', buffer: video });
  await expect(page.getByLabel('Choose operation')).toHaveValue('video-watermark');
  await expect(page.getByText('replacement.mp4', { exact: true })).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  expect(writes).toEqual([]);
});

test('a pending object replacement blocks confirmation and an invalid file preserves the checked source', async ({ page }) => {
  const state=await imageOperationFixture(page,{operation:'object-removal'});
  await page.evaluate(()=>{const original=Blob.prototype.arrayBuffer;const target=window as typeof window & {releasePicker?():void;pickerWaiting?:boolean};Blob.prototype.arrayBuffer=function(){if(this.size!==256)return original.call(this);target.pickerWaiting=true;return new Promise<ArrayBuffer>(resolve=>{target.releasePicker=()=>{void original.call(this).then(resolve);};});};});
  await page.getByLabel('Upload file to workspace',{exact:true}).setInputFiles({name:'invalid-replacement.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(256)});
  await expect.poll(()=>page.evaluate(()=>(window as typeof window & {pickerWaiting?:boolean}).pickerWaiting)).toBe(true);
  await expect(page.getByRole('button',{name:'Opening your file',exact:true})).toBeDisabled();await expect(page.getByLabel('Choose operation')).toBeDisabled();expect(state.submissions).toBe(0);
  await page.evaluate(()=>(window as typeof window & {releasePicker?():void}).releasePicker?.());
  await expect(page.getByRole('alert')).toContainText('not a supported');await expect(page).toHaveURL(/\/app\?operation=object-removal$/);
  await expect(page.getByText('background-source.png',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Remove object · 10 image credits',exact:true})).toBeEnabled();
  expect(state.uploads).toBe(2);expect(state.submissions).toBe(0);expect(state.oldRequests).toBe(0);
});

test('dropping a file in App uses the same media detection as the file picker', async ({ page }) => {
  const writes = await localOnly(page);
  await page.goto('/app/image'); await expect(page.locator('[data-app-shell]')).toBeVisible();
  const transfer = await page.evaluateHandle(base64 => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], 'dropped-in-app.mp4', { type: 'video/mp4' }));
    return data;
  }, video.toString('base64'));
  await page.locator('.workspace-main').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByLabel('Choose operation')).toHaveValue('video-watermark');
  await expect(page.getByText('dropped-in-app.mp4', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('the homepage scenario action uses the common picker and keeps its recommended image operation', async ({ page }) => {
  const writes = await localOnly(page); await page.goto('/');
  const action = page.locator('[data-scenario-panel]:visible'); await action.scrollIntoViewIfNeeded();
  await expect(action.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
  await action.locator('input[type=file]').setInputFiles({ name: 'scenario-image.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 80, height: 60, channels: 3, background: '#aabbcc' } }).png().toBuffer() });
  await expect(page.getByLabel('Choose operation')).toHaveValue('image-watermark');
  await expect(page.getByText('scenario-image.png', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('public picker placements share one capability read for the current document', async ({ page }) => {
  await localOnly(page); let reads = 0;
  await page.route('**/api/v1/capabilities', route => { reads++; return route.fulfill({ json: { operations: [] } }); });
  await page.goto('/');
  for (const selector of ['#tool', '[data-scenario-panel]:visible .result-copy', '.audience-grid .case-copy', '.site-cta']) {
    for (const placement of await page.locator(selector).all()) {
      await placement.scrollIntoViewIfNeeded();
      await expect(placement.getByRole('button', { name: 'Upload file', exact: true })).toBeEnabled();
    }
  }
  expect(reads).toBe(1);
});
