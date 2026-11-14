import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('keeps the pre-feature public upload markup, copy and icon geometry unchanged', () => {
  const source = readFileSync(new URL('./MediaLauncher.tsx', import.meta.url), 'utf8');
  expect(source).not.toContain('FreeGeminiLauncher');
  const view = source.slice(source.indexOf('  const picker =')).replaceAll('\r\n', '\n')
    // Only an explicitly supplied button label varies; the shared default remains unchanged.
    .replace(": buttonLabel ?? 'Upload file'", ": 'Upload file'").trim();
  // Independent public UI baseline from main@8abae404; destination logic lives above the view.
  expect(createHash('sha256').update(view).digest('hex')).toBe('aa126607c4f4c6cd0e5d5f94c7d53ed233973d1291ff76faac4c465197494e2a');
});
