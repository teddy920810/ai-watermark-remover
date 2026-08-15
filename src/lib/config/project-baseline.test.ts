import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('project baseline configuration', () => {
  it('uses the Astro development origin for imported Google OAuth credentials', () => {
    const importer = readProjectFile('scripts/import-google-credentials.mjs');
    const guide = readProjectFile('docs/DEVELOPER_GUIDE.md');
    expect(importer).toContain("BETTER_AUTH_URL', 'http://localhost:4321'");
    expect(importer).toContain('http://localhost:4321/api/auth/callback/google');
    expect(guide).toContain('http://localhost:4321/api/auth/callback/google');
    expect(importer).not.toContain('localhost:3000');
  });

  it('does not register the chunked Astro sitemap integration', () => {
    const astroConfig = readProjectFile('astro.config.mjs');
    const packageJson = JSON.parse(readProjectFile('package.json')) as { dependencies: Record<string, string> };
    expect(astroConfig).not.toContain("from '@astrojs/sitemap'");
    expect(astroConfig).not.toContain('sitemap()');
    expect(packageJson.dependencies).not.toHaveProperty('@astrojs/sitemap');
  });
});

