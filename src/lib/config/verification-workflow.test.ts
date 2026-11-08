import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const agents = readFileSync(new URL('../../../AGENTS.md', import.meta.url), 'utf8');
const testingGuide = readFileSync(new URL('../../../docs/TESTING_GUIDE.md', import.meta.url), 'utf8');

describe('risk-based verification workflow', () => {
  // Command execution/coverage is checked by verification-scripts and ci-plan tests.
  // These docs must link to the same authority instead of duplicating those commands.
  it.each(['AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'docs/DEVELOPER_GUIDE.md', 'docs/OPERATIONS_RUNBOOK.md'])('%s points contributors to the single verification matrix', file => {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    expect(source).toMatch(/\]\((?:docs\/)?TESTING_GUIDE\.md#动态验证矩阵\)/);
  });

  it('keeps stable required CI while allowing scoped checks for known low-risk changes', () => {
    expect(agents).toContain('`CI / verify` 和 `Required target artifacts`');
    expect(agents).toContain('未知或混合范围执行全量回归');
    expect(agents).toContain('独立产物门禁必须构建 Site/App 并追加所需 Worker');
    expect(testingGuide).toContain('低风险改动不在本地和 CI 重复运行完整 `verify`');
    expect(testingGuide).toContain('1 个正向页面和 1 个负向页面');
  });
});
