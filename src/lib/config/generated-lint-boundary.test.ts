import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('generated deployment lint boundary', () => {
  it('lints source code while excluding both deployment targets and their staging output', async () => {
    const lint = new ESLint();
    for (const filename of ['dist-target/site/_site-assets/generated.js', 'dist-target/app/server/generated.mjs', 'apps/site/dist/_site-assets/generated.js', 'apps/app/.vercel/output/functions/generated.mjs']) {
      expect(await lint.isPathIgnored(filename), filename).toBe(true);
    }
    expect(await lint.isPathIgnored('src/lib/api/processing-handler.ts')).toBe(false);
    expect(await lint.isPathIgnored('scripts/build-target.mjs')).toBe(false);
  });
});
