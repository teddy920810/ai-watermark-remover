import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('loads the functional acceptance entry directly in Node without network access', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    globalThis.fetch = () => { throw new Error('Import must not call the network'); };
    const { runProcessingAcceptance } = await import('./scripts/processing-acceptance.mjs');
    if (typeof runProcessingAcceptance !== 'function') process.exit(1);
  `], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
  expect(result.error).toBeUndefined();
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  expect(result.status, result.stderr).toBe(0);
});
