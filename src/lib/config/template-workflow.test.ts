import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('reusable fork workflow', () => {
  it('ships a neutral example configuration and a documented preview-first initializer', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
    const example = JSON.parse(readProjectFile('template/site.config.example.json')) as Record<string, string>;
    const guide = readProjectFile('docs/TEMPLATE_GUIDE.md');

    expect(packageJson.scripts['site:init']).toBe('node scripts/initialize-site.mjs');
    expect(example.siteUrl).toBe('https://www.example.com');
    expect(example.googleMeasurementId).toBe('');
    expect(guide).toContain('npm run site:init -- site.config.json');
    expect(guide).toContain('--apply');
    expect(guide).toContain('Pages CMS');
  });

  it('runs reusable-site validation in the deployment quality gate', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['site:validate']).toBe('node scripts/validate-site.mjs');
    expect(packageJson.scripts['verify:deploy']).toContain('npm run site:validate');
  });
});
