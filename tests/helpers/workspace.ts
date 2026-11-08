import type { Page } from '@playwright/test';

export async function waitForWorkspace(page: Page) {
  const shell = page.locator('[data-app-shell]');
  // Document load can finish before the lazy React workspace hydrates. Keep
  // this phase separate from business assertions and surface module failures.
  await shell.or(page.getByRole('heading', { name: 'Workspace could not open', exact: true })).first().waitFor({ state: 'visible' });
  if (!await shell.isVisible()) throw new Error('Workspace failed to open; inspect the loading error before checking business state.');
}

export async function openWorkspace(page: Page, url: string) {
  await page.goto(url);
  await waitForWorkspace(page);
}

export async function reloadWorkspace(page: Page) {
  await page.reload();
  await waitForWorkspace(page);
}
