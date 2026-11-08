import { expect, test } from '@playwright/test';
import { waitForWorkspace } from '../helpers/workspace';

test('workspace readiness waits for hydration before business assertions', async ({ page }) => {
  await page.setContent('<main data-workspace-loading><h1>Opening your workspace</h1></main>');
  let state = 'waiting';
  const ready = waitForWorkspace(page).then(() => { state = 'ready'; }, error => { state = 'failed'; throw error; });
  await page.evaluate(() => document.readyState);
  expect(state).toBe('waiting');
  await page.setContent('<main data-app-shell><input aria-label="Upload file to workspace"><p>Recovered draft</p></main>');
  await ready;
  expect(state).toBe('ready');
  await expect(page.getByText('Recovered draft')).toBeVisible();
});

test('workspace readiness rejects an explicit module failure instead of passing the loading page', async ({ page }) => {
  await page.setContent('<main><h1>Workspace could not open</h1><a href="">Reload workspace</a></main>');
  await expect(waitForWorkspace(page)).rejects.toThrow('Workspace failed to open');
  await expect(page.getByRole('link', { name: 'Reload workspace' })).toBeVisible();
});
