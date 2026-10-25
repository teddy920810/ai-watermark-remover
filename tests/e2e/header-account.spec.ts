import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const longName = 'A very long account name that must remain readable inside the account menu';
const evidence = 'output/ui-unified-upload/header';

async function signedIn(page: Page, options: { benefitsFail?: boolean } = {}) {
  await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: {
    user: { id: 'header-user', name: longName, email: 'header@example.com' },
    session: { id: 'header-session' },
  } }));
  await page.route('**/api/me/benefits', (route) => options.benefitsFail
    ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
    : route.fulfill({ json: { balance: 1, cap: 3, checkedInToday: false, dailyReward: 1 } }));
}

test('the account opens without signing out and supports keyboard, escape, and outside dismissal', async ({ page }) => {
  await signedIn(page);
  let signOutRequests = 0;
  await page.route('**/api/auth/sign-out', (route) => { signOutRequests += 1; return route.abort(); });
  await page.goto('/');
  mkdirSync(evidence, { recursive: true });
  await expect(page.locator('.header-benefits')).toContainText('1/3');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/account-initial-mocked.png` });
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeHidden();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog', { name: 'Account menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(longName);
  await expect(menu.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Open workspace' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(menu).toBeHidden();
  expect(signOutRequests).toBe(0);
});

test('signed-in headers keep readable navigation or a menu with visible brand and balance', async ({ page }) => {
  await signedIn(page);
  await page.goto('/');
  for (const width of [1920, 1440, 1280, 1024, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.locator('.site-header');
    await expect(header.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
    await expect(header.locator('.brand-logo')).toBeVisible();
    if (width > 340) await expect(header.locator('.brand span')).toBeVisible();
    await expect(header.locator('.header-benefits')).toContainText('1/3');
    expect((await header.boundingBox())!.height, `public header height at ${width}px`).toBeLessThanOrEqual(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const brand = (await header.locator('.brand').boundingBox())!;
    const account = (await header.locator('.header-auth').boundingBox())!;
    expect(brand.x + brand.width).toBeLessThanOrEqual(account.x);
    if (width <= 1280) {
      await expect(header.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      await expect(header.locator('nav')).toBeHidden();
    } else {
      await expect(header.locator('nav')).toBeVisible();
      const links = header.locator('nav > a, .nav-dropdown-trigger');
      for (const link of await links.all()) {
        expect(await link.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(30);
      }
      const nav = (await header.locator('nav').boundingBox())!;
      expect(brand.x + brand.width).toBeLessThanOrEqual(nav.x);
      expect(nav.x + nav.width).toBeLessThanOrEqual(account.x);
    }
    await page.screenshot({ path: `${evidence}/signed-in-${width}-mocked.png` });
  }
});

test('unavailable balances remain explicit and retryable from the account menu', async ({ page }) => {
  await signedIn(page, { benefitsFail: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Account menu', exact: true });
  await expect(menu.getByRole('status')).toContainText('Balance unavailable');
  await page.route('**/api/me/benefits', (route) => route.fulfill({ json: {
    balance: 2, cap: 3, checkedInToday: true, dailyReward: 1,
  } }));
  await menu.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.header-benefits')).toContainText('2/3');
  await expect(menu.getByRole('button', { name: 'Checked in today' })).toBeVisible();
});

test('mobile account controls stay usable above an open navigation menu', async ({ page }) => {
  await signedIn(page);
  let writes = 0;
  await page.route('**/api/auth/sign-out', route => { writes += 1; return route.abort(); });
  await page.route('**/api/me/check-in', route => { writes += 1; return route.abort(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation).toBeVisible();
  const navigationBox = (await navigation.boundingBox())!;
  expect(navigationBox.x).toBeGreaterThanOrEqual(0);
  expect(navigationBox.x + navigationBox.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Account menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('status')).toContainText('Free uses 1/3');
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Trial clicks perform the real hit-target checks without signing out or claiming a reward.
  await menu.getByRole('button', { name: 'Daily check-in +1' }).click({ trial: true, timeout: 3000 });
  await menu.getByRole('button', { name: 'Sign out', exact: true }).click({ trial: true, timeout: 3000 });
  expect(writes).toBe(0);
});

test('public navigation folding leaves image and video workspace headers on one row', async ({ page }) => {
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: null }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { operations: [] } }));
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ['image', 'video']) {
      await page.goto(`/app/${kind}`);
      const header = page.locator('.workspace-header');
      await expect(header.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeEnabled();
      const box = (await header.boundingBox())!;
      const brand = (await header.locator('.brand').boundingBox())!;
      const navigation = (await header.getByRole('navigation', { name: 'Media workspace' }).boundingBox())!;
      const actions = (await header.locator('.workspace-header-actions').boundingBox())!;
      expect(box.height, `${kind} header height at ${width}px`).toBeLessThanOrEqual(80);
      expect(navigation.width, `${kind} media navigation at ${width}px`).toBeLessThan(box.width / 2);
      expect(brand.x + brand.width).toBeLessThanOrEqual(navigation.x);
      expect(navigation.x + navigation.width).toBeLessThanOrEqual(actions.x);
      expect(Math.abs(brand.y + brand.height / 2 - navigation.y - navigation.height / 2)).toBeLessThanOrEqual(2);
    }
  }
});
