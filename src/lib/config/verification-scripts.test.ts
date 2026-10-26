import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { scripts } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
function commands(script: string): string[] {
  return scripts[script].split('&&').flatMap((step) => {
    const command = step.trim(); const child = /^npm run ([\w:-]+)$/.exec(command);
    return child ? commands(child[1]) : [command];
  });
}

describe('verification command coverage', () => {
  it.each(['verify', 'verify:deploy'])('runs type checking, lint and build once in %s', (script) => {
    const steps = commands(script);
    for (const command of ['astro check', 'eslint .', 'astro build']) expect(steps.filter((step) => step === command), command).toHaveLength(1);
    expect(steps).toContain('vitest run --coverage');
    expect(steps).toContain('node scripts/verify-responsive-images.mjs');
  });
  it('keeps standalone lint and build type-safe and the required browser coverage', () => {
    expect(commands('lint')).toEqual(['astro check', 'eslint .']);
    expect(commands('build')).toContain('astro check');
    expect(commands('verify')).toContain('playwright test');
    expect(commands('release:verify')).toContain('npm audit --audit-level=high');
    expect(commands('release:verify')).toContain('node scripts/validate-site.mjs');
  });
});
