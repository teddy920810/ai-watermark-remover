import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

describe('pure public catalog presentation', () => {
  it('renders supplied approved plans and operation rates with no checkout state', async () => {
    const output = fileURLToPath(new URL('../../../output/', import.meta.url));
    mkdirSync(output, { recursive: true });
    const temporary = mkdtempSync(path.join(output, 'catalog-render-'));
    if (path.dirname(realpathSync(temporary)) !== realpathSync(output)) throw new Error('Unexpected test cleanup path');
    try {
    const compiled = path.join(temporary, 'catalog.mjs');
    await build({ entryPoints: [fileURLToPath(new URL('./CreditCatalog.tsx', import.meta.url))], outfile: compiled, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
    const { default: CreditCatalog } = await import(/* @vite-ignore */ pathToFileURL(compiled).href);
    const html = renderToStaticMarkup(createElement(CreditCatalog, { catalog: {
      enabled: true, creditsEnabled: true, environment: 'live',
      packages: [{ sku: 'starter', name: 'Starter', credits: 4990, amountCents: 499, currency: 'USD' }, { sku: 'plus', name: 'Plus', credits: 9990, amountCents: 999, currency: 'USD' }, { sku: 'pro', name: 'Pro', credits: 19990, amountCents: 1999, currency: 'USD' }],
      imageCosts: { 'watermark-removal': 100, 'background-removal': 10, 'object-removal': 10 },
    }, returnTo: '/remove-background#tool' }));
    for (const text of ['4,990 credits', '9,990 credits', '19,990 credits', '$4.99', '$9.99', '$19.99', 'Recommended', 'Watermark removal', 'Background removal', 'Object removal']) expect(html).toContain(text);
    expect(html).toContain('/app/credits?sku=plus&amp;returnTo=%2Fremove-background%23tool');
    expect(html).not.toMatch(/<script|paypal-button-container|Your orders|type="radio"/);
    expect(html.match(/class="credit-package /g)).toHaveLength(4);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
