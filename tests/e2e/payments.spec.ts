import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const order = { id: '10000000-0000-4000-8000-000000000001', paypalOrderId: 'PAYPAL-ORDER', sku: 'starter', credits: 5, amountCents: 499, currency: 'USD', status: 'pending', createdAt: '2026-10-25T00:00:00Z' };
const packages = [{ sku: 'starter', name: 'Starter', credits: 5, amountCents: 499, currency: 'USD' }, { sku: 'regular', name: 'Regular', credits: 15, amountCents: 999, currency: 'USD' }, { sku: 'batch', name: 'Batch', credits: 40, amountCents: 1999, currency: 'USD' }];

async function setup(page: Page, options: { enabled?: boolean; mode?: 'success' | 'cancel' | 'pending'; signedIn?: boolean; costs?: boolean } = {}) {
  let fulfilled = false;
  await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: options.signedIn === false ? null : { user: { id: 'payment-user', name: 'Buyer', email: 'buyer@example.com' }, session: { id: 'session' } } }));
  await page.route('**/api/me/benefits', (route) => route.fulfill({ json: { balance: 0, paidBalance: fulfilled ? 5 : 0, cap: 3, checkedInToday: false, dailyReward: 1 } }));
  await page.route('**/api/payments/catalog', (route) => route.fulfill({ json: { enabled: options.enabled ?? true, creditsEnabled: true, clientId: 'sandbox-public-id', environment: 'sandbox', packages, ...(options.costs === false ? {} : { imageCosts: { 'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10 }, imageCostVersion: '2026-10-31-v1' }) } }));
  await page.route('**/api/payments/orders', (route) => route.fulfill({ json: { orders: fulfilled ? [{ ...order, status: 'fulfilled' }] : [] } }));
  await page.route('**/api/payments/paypal/orders', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ sku: 'starter' });
    expect(route.request().headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
    await route.fulfill({ status: 201, json: order });
  });
  await page.route(`**/api/payments/paypal/orders/${order.id}/capture`, async (route) => {
    if (options.mode === 'pending') return route.fulfill({ status: 503, json: { error: 'Unconfirmed' } });
    fulfilled = true;
    return route.fulfill({ json: { ...order, status: 'fulfilled' } });
  });
  await page.route(`**/api/payments/orders/${order.id}`, async (route) => {
    fulfilled = true;
    return route.fulfill({ json: { ...order, status: 'fulfilled' } });
  });
  await page.route('https://www.paypal.com/sdk/js?**', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.paypal = { Buttons: function (options) {
      var node;
      return {
        render: async function (container) {
          node = document.createElement('button'); node.textContent = 'PayPal test checkout'; node.type = 'button';
          node.onclick = async function () {
            try {
              var orderID = await options.createOrder();
              if (${JSON.stringify(options.mode)} === 'cancel') options.onCancel();
              else await options.onApprove({ orderID: orderID });
            } catch (error) { options.onError(error); }
          };
          container.appendChild(node);
        },
        close: async function () { if (node) node.remove(); }
      };
    }};
  ` }));
}

test('public pricing keeps four-column desktop packages and selection is non-billable', async ({ page, request }) => {
  await setup(page);
  const catalog = await (await request.get('/api/payments/catalog')).json();
  let creates = 0;
  await page.route('**/api/payments/paypal/orders', route => { creates++; return route.fulfill({status:500,json:{error:'No order may be created by selecting a plan'}}); });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/pricing');
  const cards = page.getByRole('region', { name: 'Image credit packages' }).locator('.credit-package');
  await expect(cards).toHaveCount(catalog.packages.length + 1);
  for (let i = 0; i < catalog.packages.length; i++) {
    const item = catalog.packages[i];
    await expect(cards.nth(i+1)).toContainText(item.name);
    await expect(cards.nth(i+1)).toContainText(item.credits.toLocaleString('en-US') + ' credits');
    await expect(cards.nth(i+1)).toContainText(new Intl.NumberFormat('en-US', {style:'currency',currency:item.currency}).format(item.amountCents/100));
  }
  const desktop = await cards.evaluateAll(nodes => nodes.map(node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width}; }));
  expect(desktop.every(box => Math.abs(box.y-desktop[0].y)<32)).toBe(true);
  expect(desktop.every((box,i) => i===0 || box.x>=desktop[i-1].x+desktop[i-1].width)).toBe(true);
  await cards.nth(1).getByRole('link', {name:'Choose '+catalog.packages[0].name}).click();
  await expect(page).toHaveURL(/\/app\/credits\?sku=/);
  await expect(page.getByRole('region', {name:'Review your purchase'})).toContainText('Starter');
  expect(creates).toBe(0);
});

test('public pricing uses two tablet columns and one mobile column without payment controls', async ({ page }) => {
  await page.setViewportSize({width:900,height:1100});
  await page.goto('/pricing');
  const cards=page.getByRole('region',{name:'Image credit packages'}).locator('.credit-package');
  await expect(cards).toHaveCount(4);
  const tablet=await cards.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));
  expect(Math.abs(tablet[0].y-tablet[1].y)).toBeLessThan(32);
  expect(Math.abs(tablet[2].y-tablet[3].y)).toBeLessThan(32);
  expect(Math.abs(tablet[0].x-tablet[2].x)).toBeLessThan(2);
  expect(tablet[1].x).toBeGreaterThanOrEqual(tablet[0].x+tablet[0].width);
  expect(tablet[2].y).toBeGreaterThan(tablet[0].y+tablet[0].height-2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await page.setViewportSize({width:390,height:844});
  const mobile=await cards.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height}}));
  expect(mobile.every(box=>Math.abs(box.x-mobile[0].x)<2)).toBe(true);
  expect(mobile.every((box,i)=>i===0||box.y>=mobile[i-1].y+mobile[i-1].height-2)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('.paypal-button-container')).toHaveCount(0);
  await expect(page.locator('script[src*="paypal.com/sdk/js"]')).toHaveCount(0);
});

test('checkout confirms only the selected plan and keeps image and processing balances separate', async ({page}) => {
  await setup(page);
  await page.goto('/app/credits?sku=regular');
  const review=page.getByRole('region',{name:'Review your purchase'});
  await expect(review).toContainText('Regular');
  await expect(review).toContainText('15 image credits');
  await expect(review).toContainText('$9.99');
  await expect(review).toContainText('PRO, brush refinement, and video processing use separate administrator credits');
  await expect(review).toContainText('Free uses are used first');
  await expect(page.locator('.credit-packages')).toHaveCount(0);
  await expect(page.locator('.payment-rates')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Change plan'})).toHaveAttribute('href','/pricing?returnTo=%2Fapp%2Fimage');
});

test('image-credit purchase discovery opens public Pricing and preserves the existing account menu', async ({ page }) => {
  await setup(page, { enabled: false });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Account menu', exact: true });
  await expect(menu).toContainText('Free uses 0/3');
  await expect(menu).toContainText('Purchased image credits 0');
  await expect(menu.getByRole('link', { name: 'Open workspace', exact: true })).toHaveAttribute('href', '/app/image');
  await expect(menu.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await menu.getByRole('link', { name: 'Buy image credits', exact: true }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'More images. One simple purchase.' })).toBeVisible();
  await expect(page.getByText('These image credits do not cover PRO, brush refinement, or video processing.', { exact: true })).toBeVisible();
});

async function imageUseWorkspace(page: Page, options: { purchased?: number; processing?: number; omitPurchased?: boolean } = {}) {
  await setup(page);
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#c9b07b' } }).jpeg().toBuffer();
  const artifact = { id: 'image-use-input', role: 'input', metadata: { kind: 'image', contentType: 'image/jpeg', byteSize: image.length, width: 80, height: 60 }, previewUrl: '/fixture/image-use.jpg', expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: ['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark'].map(operation => ({ operation, enabled: true, acceptedTypes: ['image/jpeg', 'video/mp4'], maxBytes: 100 * 1024 * 1024 })) } }));
  await page.route('**/api/v1/me', route => route.fulfill({ json: { freeUses: 0, processingCredits: options.processing ?? 0, ...(options.omitPurchased ? {} : { purchasedImageCredits: options.purchased ?? 500 }) } }));
  await page.route('**/api/v1/jobs', route => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/fixture/image-use.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: image }));
  await page.route('**/fixture/image-use-upload', route => route.fulfill({ status: 200 }));
  await page.route('**/api/v1/uploads', route => route.fulfill({ status: 201, json: { id: 'image-use-upload', uploadUrl: 'http://127.0.0.1:4379/fixture/image-use-upload' } }));
  await page.route('**/api/v1/uploads/image-use-upload/complete', route => route.fulfill({ status: 202, json: { id: 'image-use-upload', status: 'validating' } }));
  await page.route('**/api/v1/uploads/image-use-upload', route => route.fulfill({ json: { id: 'image-use-upload', status: 'ready', artifact } }));
  await page.route('**/api/v1/quotes', route => {
    const operation = route.request().postDataJSON().operation as string;
    return route.fulfill({ json: { id: `image-use-quote-${operation}`, operation, amount: operation === 'image-watermark' ? 100 : 3, unit: operation === 'image-watermark' ? 'purchasedImageCredits' : 'processingCredits', expiresAt: new Date(Date.now() + 300_000).toISOString(), expectedOutput: { format: 'JPG', contentType: 'image/jpeg', width: 80, height: 60 } } });
  });
  return image;
}

test('standard image quotes show and use the purchased-image balance without administrator credits', async ({ page }) => {
  const image = await imageUseWorkspace(page);
  await page.goto('/app/image');
  await expect(page.locator('.workspace-balances')).toContainText('Purchased image credits 500');
  await expect(page.locator('.workspace-balances')).toContainText('0 processing credits');
  await expect(page.locator('.workspace-balances').getByRole('link', { name: 'Buy image credits', exact: true })).toHaveAttribute('href', '/pricing?returnTo=%2Fapp%2Fimage');
  await page.getByLabel('Upload file to workspace').setInputFiles({ name: 'image-use.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.getByRole('button', { name: 'Remove watermarks · 100 image credits', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Processing cost')).toContainText('500 image credits');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.screenshot({ path: `${process.env.PAYPAL_UI_EVIDENCE_DIR ?? 'output/paypal-ui'}/credits-workspace-mobile.png`, fullPage: true });
});

test('PRO processing stays unavailable with only purchased image credits', async ({ page }) => {
  const image = await imageUseWorkspace(page);
  await page.goto('/app/image');
  await page.getByLabel('Upload file to workspace').setInputFiles({ name: 'image-use.jpg', mimeType: 'image/jpeg', buffer: image });
  await page.getByLabel('Choose operation').selectOption('image-watermark-pro');
  await expect(page.getByRole('button', { name: 'Remove watermarks · 3 processing credits', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Ask an administrator');
  await expect(page.locator('.workspace-controls')).toContainText('Purchased image credits do not apply.');
  await expect(page.getByRole('link', { name: 'Buy image credits', exact: true })).toHaveCount(0);
});

test('older account responses default image credits to zero and leave the file ready for purchase recovery', async ({ page }) => {
  const image = await imageUseWorkspace(page, { omitPurchased: true });
  await page.goto('/app/image');
  await page.getByLabel('Upload file to workspace').setInputFiles({ name: 'recover-image.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.locator('.workspace-balances')).toContainText('Purchased image credits 0');
  await expect(page.getByRole('button', { name: 'Remove watermarks · 100 image credits', exact: true })).toBeDisabled();
  const purchase = page.locator('.workspace-action-block').getByRole('link', { name: 'Buy image credits', exact: true });
  await expect(purchase).toHaveAttribute('target', '_blank');
  await expect(page.getByAltText('Selected image preview', { exact: true })).toBeVisible();
  await page.route('**/api/v1/me', route => route.fulfill({ json: { freeUses: 0, purchasedImageCredits: 500, processingCredits: 0 } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Remove watermarks · 100 image credits', exact: true })).toBeEnabled();
});

test('video workspace shows administrator credits without offering image-credit purchases', async ({ page }) => {
  await imageUseWorkspace(page);
  await page.goto('/app/video');
  await expect(page.locator('.workspace-balances')).toContainText('0 processing credits');
  await expect(page.locator('.workspace-balances')).not.toContainText('Purchased image credits');
  await expect(page.getByRole('link', { name: 'Buy image credits', exact: true })).toHaveCount(0);
});

test('purchase remains unavailable when payment configuration is disabled', async ({ page }) => {
  await setup(page, { enabled: false, costs: false });
  let paypalRequests = 0;
  page.on('request', (request) => { if (request.url().includes('paypal.com/sdk')) paypalRequests += 1; });
  await page.goto('/app/credits');
  await expect(page.getByText('Purchases are not available yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Checkout unavailable' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Credits per image operation' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Review your purchase' })).toContainText('Starter');
  expect(paypalRequests).toBe(0);
});

test('a forbidden capture keeps the same order recoverable without claiming credits or starting another purchase', async ({ page }) => {
  await setup(page);
  await page.route(`**/api/payments/paypal/orders/${order.id}/capture`, route => route.fulfill({ status: 403, json: { error: 'Forbidden' } }));
  await page.route(`**/api/payments/orders/${order.id}`, route => route.fulfill({ status: 403, json: { error: 'Forbidden' } }));
  let creates = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/payments/paypal/orders')) creates += 1; });
  await page.goto('/app/credits');
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.payment-outcome')).toContainText(order.id);
  await page.getByRole('button', { name: 'Check payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make another purchase' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PayPal test checkout' })).toBeHidden();
  expect(creates).toBe(1);
});

test('one-time checkout captures on the server before showing credits and refreshes the account balance', async ({ page }) => {
  await setup(page);
  await page.goto('/app/credits?returnTo=%2Fremove-background%23tool');
  await expect(page.getByRole('button', { name: 'PayPal test checkout' })).toBeVisible();
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.screenshot({ path: 'output/paypal-ui/app/credits-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to image tools' })).toHaveAttribute('href', '/remove-background#tool');
  const script = page.locator('script[src*="paypal.com/sdk/js"]');
  await expect(script).toHaveAttribute('data-sdk-integration-source', 'developer-studio');
  expect(await script.getAttribute('src')).not.toContain('buyer-country');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.locator('.header-account-panel')).toContainText('Purchased image credits 5');
  await expect(page.locator('#orders')).toContainText('Credits added');
});

test('a delayed capture stays unconfirmed until the original order is recovered', async ({ page }) => {
  await setup(page, { mode: 'pending' });
  await page.goto('/app/credits');
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.getByText('Please do not pay again.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toBeVisible();
});

test('cancelling PayPal does not capture or report added credits', async ({ page }) => {
  await setup(page, { mode: 'cancel' });
  let captures = 0;
  page.on('request', (request) => { if (request.url().endsWith('/capture')) captures += 1; });
  await page.goto('/app/credits');
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByText('Checkout cancelled.', { exact: false })).toBeVisible();
  expect(captures).toBe(0);
  await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toHaveCount(0);
});

test('mobile checkout fits the viewport and requires account sign-in', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/credits');
  await expect(page.getByRole('button', { name: 'Sign in with Google to buy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PayPal test checkout' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.screenshot({ path: 'output/paypal-ui/app/credits-mobile.png', fullPage: true });
});

test('the public blog remains free of checkout controls and the signed-in mobile header fits', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/blog');
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await expect(page.locator('.credit-checkout')).toHaveCount(0);
  await expect(page.locator('script[src*="paypal.com/sdk/js"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.screenshot({ path: 'output/paypal-ui/blog-mobile-negative.png' });
});

test('an unresolved purchase keeps its identity across historical orders and page refresh', async ({ page }) => {
  await setup(page, { mode: 'pending' });
  const historical = { ...order, id: 'old-fulfilled-order', status: 'fulfilled' };
  await page.route('**/api/payments/orders', (route) => route.fulfill({ json: { orders: [historical, order] } }));
  await page.route(`**/api/payments/orders/${order.id}`, (route) => route.fulfill({ json: order }));
  let historicalReads = 0;
  await page.route('**/api/payments/orders/old-fulfilled-order', (route) => { historicalReads += 1; return route.fulfill({ json: historical }); });
  await page.goto('/app/credits');
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  const requestKey = await page.evaluate(() => sessionStorage.getItem('clearmark-payment:payment-user:request:starter'));
  const historicalButton = page.locator('#orders tr').filter({ hasText: 'old-fulfilled-order' }).getByRole('button', { name: 'Check order' });
  await expect(historicalButton).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.locator('.payment-outcome')).toContainText(order.id);
  await expect(historicalButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Make another purchase' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('clearmark-payment:payment-user:request:starter'))).toBe(requestKey);
  expect(historicalReads).toBe(0);
});

test('an existing checkout takes priority over a new URL SKU and never creates a replacement order', async ({ page }) => {
  await setup(page, { mode: 'pending' });
  const active = { sku: 'starter', requestKey: 'retained-request-key', orderId: order.id };
  await page.addInitScript(value => sessionStorage.setItem('clearmark-payment:payment-user:active', JSON.stringify(value)), active);
  await page.route(`**/api/payments/orders/${order.id}`, route => route.fulfill({ json: order }));
  let creates = 0;
  await page.route('**/api/payments/paypal/orders', route => { creates++; return route.fulfill({ status: 500, json: { error: 'Must recover original order' } }); });
  await page.goto('/app/credits?sku=regular');
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.locator('.payment-outcome')).toContainText(order.id);
  await expect(page.locator('.payment-outcome')).toContainText('5 image credits');
  await expect(page.locator('.payment-review')).toContainText('Recovering your original purchase');
  await expect(page.locator('.selected-plan-name')).toHaveCount(0);
  await expect(page.locator('.payment-review')).not.toContainText('Regular');
  await expect(page.locator('.paypal-button-container')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Change plan' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('clearmark-payment:payment-user:active')!))).toEqual(active);
  expect(creates).toBe(0);
});

test('a compact signed-in header keeps daily check-in on one line', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app/credits');
  const checkIn = page.locator('.header-benefits').getByRole('button', { name: 'Daily check-in +1' });
  await expect(checkIn).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeHidden();
  await expect(page.locator('.header-account .lucide-user-round')).toBeVisible();
  expect((await checkIn.boundingBox())!.height).toBeLessThanOrEqual(38);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.screenshot({ path: 'output/paypal-ui/app/credits-desktop-final.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.locator('.header-account-panel')).toContainText('Purchased image credits');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'output/paypal-ui/app/credits-mobile-final.png', fullPage: true });
});

test('a lost create response resumes the same request key after refresh without capturing', async ({ page }) => {
  await setup(page);
  let creates = 0;
  let captures = 0;
  const keys: string[] = [];
  await page.route('**/api/payments/paypal/orders', async (route) => {
    creates += 1;
    keys.push(route.request().headers()['idempotency-key']);
    if (creates === 1) return route.fulfill({ status: 503, json: { error: 'Unconfirmed' } });
    return route.fulfill({ json: order });
  });
  page.on('request', (request) => { if (request.url().endsWith('/capture')) captures += 1; });
  await page.goto('/app/credits');
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByRole('alert')).toContainText('PayPal could not complete checkout');
  await page.reload();
  await page.getByRole('button', { name: 'Recover checkout' }).click();
  await expect(page.locator('.payment-outcome')).toContainText(order.id);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(captures).toBe(0);
  const active = await page.evaluate(() => JSON.parse(sessionStorage.getItem('clearmark-payment:payment-user:active')!));
  expect(active).toMatchObject({ orderId: order.id, requestKey: keys[0], sku: 'starter' });
});

// Local network-stub regressions, not evidence of an authenticated PayPal refund.
for (const outcome of [{ status: 'refunded', action: 'Refresh orders', label: 'Refunded' }, { status: 'review', action: 'Check order', label: 'Needs review' }]) {
  test(`refund regression: ${outcome.action} synchronizes the same displayed order and purchased balance`, async ({ page }) => {
    await setup(page);
    let paid = false;
    let adjusted = false;
    const currentOrder = () => ({ ...order, status: adjusted ? outcome.status : 'fulfilled' });
    await page.route('**/api/me/benefits', (route) => route.fulfill({ json: { balance: 1, paidBalance: paid && !adjusted ? 5 : 0, cap: 3, checkedInToday: false, dailyReward: 1 } }));
    await page.route('**/api/payments/orders', (route) => route.fulfill({ json: { orders: paid ? [currentOrder()] : [] } }));
    await page.route(`**/api/payments/orders/${order.id}`, (route) => route.fulfill({ json: currentOrder() }));
    await page.route(`**/api/payments/paypal/orders/${order.id}/capture`, (route) => {
      paid = true;
      return route.fulfill({ json: currentOrder() });
    });
    await page.goto('/app/credits');
    await page.getByRole('button', { name: 'PayPal test checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await expect(page.locator('.header-account-panel')).toContainText('Purchased image credits 5');
    adjusted = true;
    await page.locator('#orders').getByRole('button', { name: outcome.action, exact: true }).click();
    await expect(page.locator('#orders')).toContainText(outcome.label);
    await expect(page.locator('.payment-outcome').getByRole('heading', { name: outcome.label, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your credits have arrived' })).toHaveCount(0);
    await expect(page.locator('.header-account-panel')).toContainText('Purchased image credits 0');
    await expect(page.locator('.header-account-panel')).toContainText('Free uses 1/3');
  });
}
