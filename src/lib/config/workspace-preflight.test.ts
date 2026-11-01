import { describe, expect, it } from 'vitest';
import { validateWorkspace } from '../../../scripts/workspace-preflight.mjs';

describe('registered local workspace preflight', () => {
  const state = { root: '/device/project', registeredRoot: '/device/project', origin: 'https://github.com/teddy920810/ai-watermark-remover.git', changedPaths: ['AGENTS.md'], classifiedPaths: ['AGENTS.md'], readOnly: false };
  it('allows an explicitly classified canonical workspace without requiring a drive letter', () => {
    expect(validateWorkspace(state)).toEqual([]);
    expect(validateWorkspace({ ...state, changedPaths: [] })).toEqual([]);
  });
  it('blocks an incorrect checkout, remote, missing registration or unclassified changes', () => {
    expect(validateWorkspace({ ...state, root: '/device/other' }).join()).toContain('registered');
    expect(validateWorkspace({ ...state, registeredRoot: '' }).join()).toContain('registration');
    expect(validateWorkspace({ ...state, origin: 'https://github.com/other/ai-watermark-remover.git' }).join()).toContain('origin');
    expect(validateWorkspace({ ...state, changedPaths: ['src/unknown.ts'] }).join()).toContain('unclassified');
    expect(validateWorkspace({ ...state, readOnly: true, changedPaths: ['src/unknown.ts'] })).toEqual([]);
  });
});
