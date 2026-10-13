import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface SmokeWorkflow {
  jobs: {
    smoke: {
      steps: Array<{ run?: string; env?: Record<string, string> }>;
    };
  };
}

describe('production smoke workflow', () => {
  it.each([
    'npm run test:smoke:production',
    'npm run test:smoke:background-removal',
  ])('uses the canonical www origin for %s', (command) => {
    const workflow = parse(readFileSync(
      new URL('../../../.github/workflows/production-smoke.yml', import.meta.url),
      'utf8',
    )) as SmokeWorkflow;
    const step = workflow.jobs.smoke.steps.find(({ run }) => run === command);

    // An apex redirect retains the POST Origin and triggers Astro's 403 guard.
    expect(step?.env?.SMOKE_BASE_URL).toBe('https://www.watermarkgemini.com');
  });
});
