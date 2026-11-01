import { expect, test } from '@playwright/test';

test('anonymous visitors can discover Pricing from the main website navigation', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Pricing', exact: true })).toHaveAttribute('href', '/pricing');
  }
});

test('public Pricing has the runtime catalog, canonical and no checkout or order requests', async ({ page, request }) => {
  const catalogResponse = await request.get('/api/payments/catalog');
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json();
  const response = await request.get('/pricing');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-robots-tag'] ?? '').not.toContain('noindex');
  const html = await response.text();
  expect(html).not.toMatch(/clientSecret|merchantId|webhookId|PAYPAL_CLIENT_SECRET|DATABASE_URL|CreditCheckout/);
  for (const item of catalog.packages) {
    expect(html).toContain(item.name);
    expect(html).toContain(new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(item.amountCents / 100));
  }
  let forbidden = 0;
  await page.route('https://www.paypal.com/sdk/js?**', route => { forbidden++; return route.abort(); });
  await page.route('**/api/payments/orders**', route => { forbidden++; return route.abort(); });
  await page.route('**/api/payments/paypal/**', route => { forbidden++; return route.abort(); });
  await page.goto('/pricing?returnTo=%2Fremove-background%23tool');
  await expect(page.locator('main h1')).toHaveText('More images. One simple purchase.');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/pricing$/);
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(page.locator('.credit-package')).toHaveCount(catalog.packages.length + 1);
  await expect(page.locator('#orders')).toHaveCount(0);
  await expect(page.locator('script[src*="paypal.com/sdk/js"]')).toHaveCount(0);
  const first = page.locator('.credit-package').nth(1).getByRole('link', { name: `Choose ${catalog.packages[0].name}` });
  await expect(first).toHaveAttribute('href', `/app/credits?sku=${catalog.packages[0].sku}&returnTo=%2Fremove-background%23tool`);
  expect(forbidden).toBe(0);
  const sitemap = await request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain('/pricing</loc>');
  expect((await request.get('/pricing-unknown')).status()).toBe(404);
  expect((await request.get('/pricing/unknown')).status()).toBe(404);
});
