import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
const cachePath = '.vercel/cache/optimized-images';
const cacheAction = '55cc8345863c7cc4c66a329aec7e433d2d1c52a9';

describe('remote optimized image cache', () => {
  it('writes to Vercel native build cache, outside deployed public files', () => {
    // Vercel persists tools' files here before install/build even with framework=Other:
    // https://vercel.com/docs/deployments/troubleshoot-a-build#what-is-cached
    expect(read('scripts/optimize-images.mjs')).toContain("path.join(repositoryRoot, '.vercel', 'cache', 'optimized-images')");
    expect(read('.gitignore').split(/\r?\n/)).toContain('.vercel/');
    expect(read('.vercelignore').split(/\r?\n/)).toContain('.vercel/');
    expect(JSON.parse(read('apps/site/vercel.json')).buildCommand).toBe('node ../../scripts/build-target.mjs site');
  });

  it.each([
    ['.github/workflows/ci.yml', 'verify', 'node22'],
    ['.github/workflows/build-targets.yml', 'build', 'node24'],
  ])('restores and saves only disposable images without replacing checks: %s', (file, job, nodeVersion) => {
    const workflow = YAML.parse(read(file));
    const steps = workflow.jobs[job].steps;
    const restore = steps.find((step: { id?: string }) => step.id === 'image-cache');
    const save = steps.find((step: { uses?: string }) => step.uses === `actions/cache/save@${cacheAction}`);
    expect(restore).toBeDefined();
    expect(save).toBeDefined();
    expect(restore.uses).toBe(`actions/cache/restore@${cacheAction}`);
    expect(restore.with.path).toBe(cachePath);
    expect(save.with.path).toBe(cachePath);
    expect(restore.with.key).toContain(nodeVersion);
    expect(restore.with.key).toContain("hashFiles('package-lock.json', 'scripts/lib/optimized-images.mjs', 'scripts/optimize-images.mjs')");
    expect(restore.with.key).toContain('${{ github.sha }}');
    expect(restore.with['restore-keys']).not.toContain('github.sha');
    expect(save.with.key).toBe('${{ steps.image-cache.outputs.cache-primary-key }}');
    expect(save.if).toContain('success()');
    expect(save.if).toContain("steps.image-cache.outputs.cache-hit != 'true'");
    expect(restore['continue-on-error']).toBeUndefined();
    expect(save['continue-on-error']).toBeUndefined();
    const check = steps.find((step: { run?: string }) => step.run === (job === 'verify' ? 'npm run ci:verify' : 'node scripts/build-target.mjs ${{ matrix.target }}'));
    expect(check).toBeDefined();
    expect(check.if).toBeUndefined();
    expect(steps.indexOf(restore)).toBeLessThan(steps.indexOf(check));
    expect(steps.indexOf(save)).toBeGreaterThan(steps.indexOf(check));
    if (job === 'verify') {
      expect(restore.if).toBe("steps.plan.outputs.mode == 'full' || steps.plan.outputs.mode == 'ui'");
      expect(save.if).toContain(restore.if);
    } else {
      expect(restore.if).toBe("matrix.target == 'site'");
      expect(save.if).toContain(restore.if);
      expect(workflow.jobs.required.name).toBe('Required target artifacts');
      expect(workflow.jobs.required.if).toBe('always()');
      expect(workflow.jobs.required.needs).toEqual(['targets', 'build']);
      // Re-running the exact SHA for a warm-cache measurement must still upload
      // and validate the artifact rather than fail on its existing immutable name.
      expect(steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@')).with.overwrite).toBe(true);
    }
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});
