import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const tools = [
  { path: '/remove-background', operation: 'background-removal', button: 'Remove background' },
  { path: '/remove-object', operation: 'object-removal', button: 'Remove object' },
] as const;

async function fixture(page: Page, tool: typeof tools[number], initiallySignedIn = true, catalogFail = false, initialCanvasTop?: number) {
  const state = { signedIn: initiallySignedIn, cost: 10, version: '2026-10-31-v1', catalogReads: 0, catalogFail };
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: state.signedIn ? { user: { id: 'credit-consent-user', name: 'Credit buyer' }, session: { id: 'credit-session' } } : null }));
  await page.route('**/api/me/benefits', route => route.fulfill({ json: { balance: 0, paidBalance: 4990, cap: 3, dailyReward: 1, checkedInToday: false } }));
  await page.route('**/api/payments/catalog', route => {
    state.catalogReads += 1;
    if (state.catalogFail) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    return route.fulfill({ json: { enabled: false, creditsEnabled: true, environment: 'sandbox', packages: [], imageCosts: { 'watermark-removal': 100, 'background-removal': state.cost, 'object-removal': state.cost }, imageCostVersion: state.version } });
  });
  let uploads = 0;
  await page.route('**/api/upload-url', route => route.fulfill({ json: { url: 'https://uploads.test/credit-consent', key: `uploads/credit-consent-${++uploads}.png`, expiresIn: 600 } }));
  await page.route('https://uploads.test/credit-consent', route => route.fulfill({ status: 200 }));
  await page.goto(tool.path);
  const container = page.locator('#tool');
  await container.scrollIntoViewIfNeeded();
  await expect(container.locator('astro-island')).not.toHaveAttribute('ssr', '');
  const image = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#5577aa' } }).png().toBuffer();
  await container.locator('input[type=file]').setInputFiles({ name: 'consent-image.png', mimeType: 'image/png', buffer: image });
  if (tool.operation === 'object-removal') {
    const canvas = page.getByLabel('Object removal mask canvas');
    await expect(page.locator('.hero-inner')).toHaveClass(/is-tool-expanded/);
    await expect(container.locator('.object-editor-stage > img')).toHaveJSProperty('naturalWidth', 128);
    await expect(canvas).toHaveJSProperty('width', 128);
    await expect(canvas).toHaveJSProperty('height', 96);
    if (initialCanvasTop !== undefined) {
      await canvas.evaluate((element, top) => {
        window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - top, behavior: 'instant' });
      }, initialCanvasTop);
    }
    // Expanding the hero can move the editor behind the sticky mobile header.
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await canvas.hover({ position: { x: bounds!.width * .4, y: bounds!.height * .4 } });
    const visibleBounds = await canvas.boundingBox();
    expect(visibleBounds).not.toBeNull();
    await page.mouse.down();
    await page.mouse.move(visibleBounds!.x + visibleBounds!.width * .6, visibleBounds!.y + visibleBounds!.height * .6, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => canvas.evaluate(element => {
      const surface = element as HTMLCanvasElement;
      const pixels = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 10);
    })).toBe(true);
  }
  return { state, container, button: container.getByRole('button', { name: tool.button, exact: true }) };
}

test('mobile object selection recovers the visible canvas after the expanded layout changes its scroll position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The CI failure began with the canvas top at -28px behind the sticky header.
  const { container, button } = await fixture(page, tools[1], true, false, -28);
  await expect(container.getByRole('status')).toContainText('1 free use first; otherwise 10 image credits');
  await expect(button).toBeEnabled();
});

for (const tool of tools) {
  test(`${tool.operation} shows the maximum charge before submitting the displayed consent`, async ({ page }) => {
    let body: Record<string, unknown> | undefined;
    await page.route('**/api/jobs', route => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 402, json: { error: 'No credits remaining' } });
    });
    if (tool.operation === 'object-removal') await page.setViewportSize({ width: 390, height: 844 });
    const { container, button } = await fixture(page, tool);
    await expect(container.getByRole('status')).toContainText('1 free use first; otherwise 10 image credits');
    await container.screenshot({ path: `${process.env.PAYPAL_UI_EVIDENCE_DIR ?? 'output/paypal-ui'}/${tool.operation}-consent.png` });
    await button.click();
    await expect(container.getByRole('alert')).toContainText('No credits remaining');
    expect(body).toMatchObject({ operation: tool.operation, imageCreditConsent: { imageCostVersion: '2026-10-31-v1', maxImageCredits: 10 } });
  });

  test(`${tool.operation} refreshes a changed price without resubmitting or discarding the selected image`, async ({ page }) => {
    const bodies: Array<Record<string, unknown>> = [];
    const { state, container, button } = await fixture(page, tool);
    await page.route('**/api/jobs', route => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        state.cost = 20; state.version = 'simulated-price-change-v2';
        return route.fulfill({ status: 409, json: { code: 'image_price_changed', error: 'Review the current image credit price.' } });
      }
      return route.fulfill({ status: 402, json: { error: 'No credits remaining' } });
    });
    await expect(container.getByRole('status')).toContainText('otherwise 10 image credits');
    await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect(container.getByRole('status')).toContainText('otherwise 20 image credits');
    await expect(container.getByRole('alert')).toContainText('click again');
    await expect(container.locator('img[src^="blob:"]')).toBeVisible();
    await expect(button).toBeEnabled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ imageCreditConsent: { imageCostVersion: '2026-10-31-v1', maxImageCredits: 10 } });
    await button.click();
    await expect(container.getByRole('alert')).toContainText('No credits remaining');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ imageCreditConsent: { imageCostVersion: 'simulated-price-change-v2', maxImageCredits: 20 } });
    expect(state.catalogReads).toBe(2);
  });

  test(`${tool.operation} keeps the original displayed consent through Google sign-in`, async ({ page }) => {
    await page.addInitScript(() => { window.open = () => ({ location: { href: '' }, close() {} }) as unknown as Window; });
    await page.route('**/api/auth/sign-in/social', route => {
      expect(route.request().postDataJSON()).toMatchObject({ provider: 'google', disableRedirect: true });
      return route.fulfill({ json: { url: 'https://accounts.google.test/fixture', redirect: false } });
    });
    const bodies: Array<Record<string, unknown>> = [];
    const { state, container, button } = await fixture(page, tool, false);
    await page.route('**/api/jobs', route => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { code: 'image_price_changed', error: 'Review the current image credit price.' } });
    });
    await expect(container.getByRole('status')).toContainText('otherwise 10 image credits');
    await button.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('otherwise up to 10 image credits');
    await page.getByRole('dialog').getByRole('button', { name: /Continue with Google$/ }).click();
    state.signedIn = true; state.cost = 20; state.version = 'changed-during-login-v2';
    await page.evaluate(() => window.postMessage({ type: 'clearmark-auth-complete' }, window.location.origin));
    await expect(container.getByRole('status')).toContainText('otherwise 20 image credits');
    await expect(container.getByRole('alert')).toContainText('click again');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ imageCreditConsent: { imageCostVersion: '2026-10-31-v1', maxImageCredits: 10 } });
  });

  test(`${tool.operation} dismissing sign-in cancels automatic processing consent`, async ({ page }) => {
    let jobs = 0;
    await page.route('**/api/jobs', route => { jobs += 1; return route.fulfill({ status: 402, json: { error: 'Unexpected processing' } }); });
    const { state, button } = await fixture(page, tool, false);
    await button.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    state.signedIn = true;
    await page.evaluate(() => window.postMessage({ type: 'clearmark-auth-complete' }, window.location.origin));
    await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
    expect(jobs).toBe(0);
  });
}

test('unavailable prices disable processing until an explicit price retry succeeds', async ({ page }) => {
  const { state, container, button } = await fixture(page, tools[0], true, true);
  await expect(container.getByRole('status')).toContainText('Image credit price unavailable');
  await expect(button).toBeDisabled();
  state.catalogFail = false;
  await container.getByRole('button', { name: 'Retry credit price', exact: true }).click();
  await expect(container.getByRole('status')).toContainText('otherwise 10 image credits');
  await expect(button).toBeEnabled();
});
