import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };
const agents = readFileSync(new URL('../../../AGENTS.md', import.meta.url), 'utf8');
const testingGuide = readFileSync(new URL('../../../docs/TESTING_GUIDE.md', import.meta.url), 'utf8');
const contributing = readFileSync(new URL('../../../CONTRIBUTING.md', import.meta.url), 'utf8');

describe('risk-based verification workflow', () => {
  it('provides cross-platform scoped and release verification commands', () => {
    expect(packageJson.scripts).toMatchObject({
      'check:fast': 'npm run content:validate && npm test',
      'check:content': 'npm run content:validate && vitest run src/lib/content && npm run build',
      'check:ui': 'vitest run src/layouts src/lib/content/blog-layout.test.ts src/lib/content/site-visual-system.test.ts src/lib/content/landing-pages.test.ts src/lib/content/homepage.test.ts src/lib/content/item-visibility.test.ts && playwright test tests/e2e/site-quality.spec.ts',
      'release:verify': 'npm run audit:dependencies && npm run site:validate && npm run verify',
    });
  });

  it('keeps full CI verification while allowing scoped local checks', () => {
    expect(agents).toContain('CI 中的 `npm run verify` 是合并 `main` 的必需门禁');
    expect(agents).toContain('低风险改动不要求在本地与 CI 重复运行完整 `npm run verify`');
    expect(testingGuide).toContain('1 个正向页面和 1 个负向页面');
    expect(contributing).toContain('根据改动范围选择本地检查');
  });
});
