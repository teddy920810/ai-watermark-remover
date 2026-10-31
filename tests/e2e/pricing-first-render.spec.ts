import { expect, test } from '@playwright/test';

interface PublicCatalog {
  enabled: boolean;
  creditsEnabled: boolean;
  environment: 'sandbox' | 'live';
  packages: Array<{ sku: string; name: string; credits: number; amountCents: number; currency: string }>;
  imageCosts: Record<string, number>;
  imageCostVersion: string;
}

test('pricing first render contains the runtime catalog before browser requests', async ({ request }) => {
  const catalogResponse = await request.get('/api/payments/catalog');
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json() as PublicCatalog;
  expect(catalog.packages).toHaveLength(3);

  const response = await request.get('/app/credits');
  expect(response.status()).toBe(200);
  const html = await response.text();
  const packagesHtml = html.match(/<fieldset\b[^>]*class="credit-packages"[^>]*>([\s\S]*?)<\/fieldset>/)?.[1] ?? '';
  expect(packagesHtml.match(/<article\b/g) ?? []).toHaveLength(catalog.packages.length + 1);
  expect(packagesHtml).toContain('Try for free');
  for (const item of catalog.packages) {
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(item.amountCents / 100);
    expect(packagesHtml).toContain(`id="credit-package-${item.sku}"`);
    expect(packagesHtml).toContain(`${item.name}: ${item.credits.toLocaleString('en-US')} credits for ${price} ${item.currency}`);
  }
  expect(html).not.toContain('Loading payment options');
  expect(html).not.toMatch(/clientSecret|merchantId|webhookId|PAYPAL_CLIENT_SECRET|DATABASE_URL/);
});

test('pricing stays in place while catalog and anonymous sign-in checks are delayed', async ({ page, request }) => {
  const response = await request.get('/api/payments/catalog');
  expect(response.ok()).toBe(true);
  const catalog = await response.json() as PublicCatalog;
  // The same runtime catalog returns after hydration; no alternate prices are
  // embedded into the browser fixture or into the page source by this test.
  let catalogRequests = 0;
  let sdkRequests = 0;
  let releaseCatalog!: () => void;
  let releaseAuth!: () => void;
  const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
  const authGate = new Promise<void>(resolve => { releaseAuth = resolve; });
  await page.route('**/api/payments/catalog', async route => {
    catalogRequests += 1;
    await catalogGate;
    await route.fulfill({ json: catalog });
  });
  await page.route('**/api/auth/get-session', async route => {
    await authGate;
    await route.fulfill({ json: null });
  });
  await page.route('https://www.paypal.com/sdk/js?**', route => { sdkRequests += 1; return route.abort(); });
  await page.setViewportSize({ width: 1440, height: 1100 });
  const catalogStarted = page.waitForRequest('**/api/payments/catalog');

  try {
    await page.goto('/app/credits', { waitUntil: 'domcontentloaded' });
    await catalogStarted;
    const group = page.getByRole('group', { name: 'Choose an image credit package' });
    await expect(group.locator('.credit-package')).toHaveCount(catalog.packages.length + 1);
    const history = page.locator('.payment-history');
    await expect(history).toContainText('Checking sign-in');
    await expect(history).not.toContainText('Sign in to see purchases');
    await expect(page.getByText('Loading payment options')).toHaveCount(0);
    expect(catalogRequests).toBe(1);
    expect(sdkRequests).toBe(0);
    await expect(page.locator('script[src*="paypal.com/sdk/js"]')).toHaveCount(0);
    await expect(page.locator('.paypal-button-container')).toBeHidden();

    const positions = async () => page.locator('.credit-packages, .payment-rates, .payment-review, .pricing-terms').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })));
    const before = await positions();
    expect(before).toHaveLength(4);
    releaseCatalog();
    releaseAuth();
    await expect(history).toContainText('Sign in to see purchases for your account.');
    await expect(history).not.toContainText('Checking sign-in');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = await positions();
    expect(catalogRequests).toBe(1);
    for (let index = 0; index < before.length; index += 1) {
      expect(Math.abs(after[index].top - before[index].top)).toBeLessThanOrEqual(2);
      expect(Math.abs(after[index].height - before[index].height)).toBeLessThanOrEqual(2);
    }
    await expect(group.locator('input[type="radio"]:checked')).toHaveAttribute('value', catalog.packages[0].sku);
  } finally {
    releaseCatalog();
    releaseAuth();
  }
});

test('enabled SSR waits for client catalog confirmation before PayPal SDK bootstrap', async ({ page, request }) => {
  const response = await request.get('/api/payments/catalog');
  expect(response.ok()).toBe(true);
  const catalog = await response.json() as PublicCatalog & { clientId?: string };
  test.skip(catalog.environment !== 'sandbox' || catalog.enabled !== true || catalog.creditsEnabled !== true || catalog.clientId !== 'ssr-test-public-id',
    'Opt in with enabled dummy Sandbox checkout and clientId=ssr-test-public-id; this bootstrap check never accepts real credentials.');

  const htmlResponse = await request.get('/app/credits');
  expect(htmlResponse.ok()).toBe(true);
  const html = await htmlResponse.text();
  const packagesHtml = html.match(/<fieldset\b[^>]*class="credit-packages"[^>]*>([\s\S]*?)<\/fieldset>/)?.[1] ?? '';
  expect(packagesHtml.match(/<article\b/g) ?? []).toHaveLength(catalog.packages.length + 1);
  expect(html).not.toContain('Loading payment options');

  let catalogRequests = 0;
  let sdkRequests = 0;
  let createRequests = 0;
  let captureRequests = 0;
  let releaseCatalog!: () => void;
  const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
  await page.route('**/api/payments/catalog', async route => {
    catalogRequests += 1;
    await catalogGate;
    await route.fulfill({ json: catalog });
  });
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: {
    user: { id: 'ssr-bootstrap-buyer', name: 'SSR test buyer', email: 'ssr-buyer@example.com' },
    session: { id: 'ssr-bootstrap-session' },
  } }));
  await page.route('**/api/me/benefits', route => route.fulfill({ json: { balance: 0, paidBalance: 0, cap: 3, checkedInToday: false, dailyReward: 1 } }));
  await page.route('**/api/payments/orders', route => route.fulfill({ json: { orders: [] } }));
  await page.route('**/api/payments/paypal/orders', route => {
    createRequests += 1;
    return route.fulfill({ status: 500, json: { error: 'SDK bootstrap must not create an order.' } });
  });
  await page.route('**/api/payments/paypal/orders/*/capture', route => {
    captureRequests += 1;
    return route.fulfill({ status: 500, json: { error: 'SDK bootstrap must not capture an order.' } });
  });
  // Use the same vendor-facing Buttons function shape as the payment recovery
  // fixtures. Only render a local button; never invoke its payment callbacks.
  await page.route('https://www.paypal.com/sdk/js?**', route => {
    sdkRequests += 1;
    expect(new URL(route.request().url()).searchParams.get('client-id')).toBe('ssr-test-public-id');
    return route.fulfill({ contentType: 'application/javascript', body: `
      window.paypal = { Buttons: function (options) {
        var node;
        return {
          render: async function (container) {
            node = document.createElement('button'); node.textContent = 'PayPal bootstrap test checkout'; node.type = 'button';
            container.appendChild(node);
          },
          close: async function () { if (node) node.remove(); }
        };
      }};
    ` });
  });
  const catalogStarted = page.waitForRequest('**/api/payments/catalog');

  try {
    await page.goto('/app/credits', { waitUntil: 'domcontentloaded' });
    await catalogStarted;
    const group = page.getByRole('group', { name: 'Choose an image credit package' });
    await expect(group.locator('.credit-package')).toHaveCount(catalog.packages.length + 1);
    await expect(page.locator('.payment-history').getByRole('button', { name: 'Refresh orders' })).toBeVisible();
    await expect(page.getByText('Checking payment availability')).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(catalogRequests).toBe(1);
    expect(sdkRequests).toBe(0);
    await expect(page.locator('script[src*="paypal.com/sdk/js"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'PayPal bootstrap test checkout' })).toHaveCount(0);
    expect(createRequests).toBe(0);
    expect(captureRequests).toBe(0);

    releaseCatalog();
    await expect(page.getByRole('button', { name: 'PayPal bootstrap test checkout' })).toBeVisible();
    await expect(page.getByText('Checking payment availability')).toHaveCount(0);
    await expect(group.locator('.credit-package')).toHaveCount(catalog.packages.length + 1);
    expect(catalogRequests).toBe(1);
    expect(sdkRequests).toBe(1);
    expect(createRequests).toBe(0);
    expect(captureRequests).toBe(0);
  } finally {
    releaseCatalog();
  }
});
