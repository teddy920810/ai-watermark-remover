import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { verificationCommands, runVerification } from '../../../scripts/verify.mjs';

describe('shared local and CI verification paths', () => {
  it('builds only Site for local content while preserving types, content safety and responsive images', () => {
    const steps = verificationCommands('content');
    expect(steps).toContain('content:validate');
    expect(steps).toContain('test -- src/lib/content');
    expect(steps).toContain('typecheck');
    expect(steps).toContain('build:site');
    expect(steps).toContain('verify:responsive-images -- dist-target/site');
    expect(steps).not.toContain('build');
    expect(verificationCommands('content', true)).toEqual(['content:validate', 'test -- src/lib/content src/lib/build/content-ci.test.ts']);
  });
  it('shares the complete regression gate and retains separate audit and publication checks', () => {
    const full = ['test:coverage', 'lint:code', 'build', 'test:e2e', 'test:components'];
    expect(verificationCommands('full')).toEqual(full);
    expect(verificationCommands('release')).toEqual(['audit:dependencies', 'site:validate', ...full]);
    expect(verificationCommands('full', true)).toEqual(['audit:dependencies', 'verify']);
    expect(verificationCommands('ui')).toEqual(verificationCommands('ui', true));
    expect(verificationCommands('ui')[0]).toBe('images:optimize');
    expect(verificationCommands('docs', true)).toEqual([]);
    expect(() => verificationCommands('unknown')).toThrow();
  });
  it('executes npm through Node without a platform shell and stops on the first failure', () => {
    const execute = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 9 });
    expect(() => runVerification('release', { npmPath: '/fixture/npm-cli.js', execute })).toThrow('site:validate');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toBe(process.execPath);
    expect(execute.mock.calls[0][1]).toEqual(['/fixture/npm-cli.js', 'run', 'audit:dependencies']);
    expect(execute.mock.calls[0][2]).toMatchObject({ shell: false, stdio: 'inherit' });
  });
  it('requires an npm execution context before starting checks', () => {
    const execute = vi.fn();
    expect(() => runVerification('fast', { npmPath: '', execute })).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('forwards content selectors and caps only local test concurrency', () => {
    const execute = vi.fn().mockReturnValue({ status: 0 });
    runVerification('content', { npmPath: '/fixture/npm-cli.js', execute, env: {} });
    expect(execute.mock.calls[1][1]).toEqual(['/fixture/npm-cli.js', 'run', 'test', '--', 'src/lib/content', '--maxWorkers=2']);
    expect(execute.mock.calls[4][1]).toEqual(['/fixture/npm-cli.js', 'run', 'verify:responsive-images', '--', 'dist-target/site']);
    execute.mockClear();
    runVerification('content', { ci: true, npmPath: '/fixture/npm-cli.js', execute, env: { CI: 'true' } });
    expect(execute.mock.calls[1][1]).toEqual(['/fixture/npm-cli.js', 'run', 'test', '--', 'src/lib/content', 'src/lib/build/content-ci.test.ts']);
  });
  it('checks the selected Site output rather than unrelated stale combined HTML', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'responsive-target-'));
    try {
      writeFileSync(path.join(directory, 'index.html'), '<img src="/uploads/unoptimized.png">');
      const check = () => spawnSync(process.execPath, ['scripts/verify-responsive-images.mjs', directory], { encoding: 'utf8' });
      expect(check().status).not.toBe(0);
      writeFileSync(path.join(directory, 'index.html'), '<picture><source srcset="/generated/uploads/optimized.png-480.webp"><img src="/uploads/optimized.png"></picture>');
      const result = check(); expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('1 HTML files');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
