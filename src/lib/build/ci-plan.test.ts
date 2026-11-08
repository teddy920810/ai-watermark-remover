import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ignore from 'ignore';
import { classifyVerification } from '../../../scripts/ci-plan.mjs';
import { verificationCommands as sharedCommands } from '../../../scripts/verify.mjs';
const verificationCommands = (mode: string) => sharedCommands(mode, true);

describe('required CI risk selection', () => {
  it('checks documentation without installing dependencies or running product tests', () => {
    expect(classifyVerification(['README.md', 'docs/CONTENT_API.md']).mode).toBe('docs');
    expect(verificationCommands('docs')).toEqual([]);
  });
  it('checks plain content and original raster assets without payment or Worker suites', () => {
    for (const file of ['src/content/blog/example.md', 'src/content/landing-pages/example.json', 'public/uploads/example.png']) {
      expect(classifyVerification([file]).mode, file).toBe('content');
    }
    expect(verificationCommands('content').join(' ')).toContain('src/lib/content');
    expect(verificationCommands('content').join(' ')).toContain('content-ci.test.ts');
    expect(verificationCommands('content').join(' ')).not.toMatch(/coverage|verify|payment|worker/);
  });
  it('permits only known public styles in the UI lane', () => {
    expect(classifyVerification(['src/styles/tool-landing.css']).mode).toBe('ui');
    expect(verificationCommands('ui')).toEqual(sharedCommands('ui'));
    expect(verificationCommands('ui')[0]).toBe('images:optimize');
    expect(classifyVerification(['src/components/auth/AuthControls.tsx']).mode).toBe('full');
  });
  it('fails closed for missing diffs, executable content, financial, build and mixed scopes', () => {
    for (const files of [null, [], ['unrecognized.file'], ['src/content/blog/example.mdx'], ['public/uploads/x.svg'], ['src/content/settings/site.json'], ['src/content/legal/terms.md'], ['src/content/homepage/home.json'], ['src/pages/api/example.ts'], ['src/lib/payments/prices.ts'], ['apps/worker/entry.ts'], ['package.json'], ['.github/workflows/ci.yml'], ['.vercelignore'], ['src/content/blog/example.md', 'src/styles/global.css']]) {
      expect(classifyVerification(files).mode, String(files)).toBe('full');
    }
    expect(classifyVerification(['docs/notes.md', 'src/content/blog/example.md']).mode).toBe('content');
    expect(verificationCommands('full')).toEqual(['audit:dependencies', 'test:coverage', 'lint:code', 'typecheck', 'images:optimize', 'test:e2e', 'test:components']);
    expect(() => verificationCommands('unknown')).toThrow();
  });
  it('always emits the existing trusted verify context and plans from immutable event SHAs', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('  verify:');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('github.event.pull_request.base.sha');
    expect(workflow).toContain('node scripts/ci-plan.mjs');
    expect(workflow).not.toMatch(/paths-ignore:|continue-on-error:|secrets\./);
  });
});

describe('deployment upload closure', () => {
  it('excludes private and generated material while retaining complete runtime inputs', () => {
    const rules = ignore().add(readFileSync(new URL('../../../.vercelignore', import.meta.url), 'utf8'));
    for (const file of ['.env.local', '.secrets/key.json', 'dewatermark.txt', 'nero.txt', 'S3-info.txt', '.tools/tool.exe', 'dist-target/site/index.html', 'test-image/private.png', '.playwright-mcp/trace.zip', 'output/evidence.json', 'public/generated/old.webp']) expect(rules.ignores(file), file).toBe(true);
    for (const file of ['src/content/blog/post.md', 'src/lib/payments/prices.ts', 'public/uploads/original.png', 'scripts/build-target.mjs', 'package-lock.json', '.env.example']) expect(rules.ignores(file), file).toBe(false);
  });
});
