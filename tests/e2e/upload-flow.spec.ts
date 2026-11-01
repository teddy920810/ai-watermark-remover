import { expect, test } from '@playwright/test';

test('daily check-in grants one free use and then becomes unavailable for the day', async ({ page }) => {
  let checkIns = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/get-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'google-user-1', name: 'Test User' }, session: { id: 'session-1' } }),
  }));
  await page.route('**/api/me/benefits', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ balance: 1, cap: 3, dailyReward: 1, checkedInToday: false }),
  }));
  await page.route('**/api/me/check-in', (route) => {
    expect(route.request().method()).toBe('POST');
    checkIns += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ balance: 2, cap: 3, dailyReward: 1, checkedInToday: true, granted: true, balanceFull: false }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.header-benefits')).toBeVisible();
  await expect(page.locator('.header-benefits')).toContainText('1/3');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  const accountMenu = page.getByRole('dialog', { name: 'Account menu', exact: true });
  await accountMenu.getByRole('button', { name: 'Daily check-in +1', exact: true }).click();
  await expect(page.locator('.header-benefits')).toContainText('2/3');
  await expect(accountMenu.getByRole('button', { name: 'Checked in today', exact: true })).toBeDisabled();
  expect(checkIns).toBe(1);
});
