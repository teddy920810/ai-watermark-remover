import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import * as targets from '../../../scripts/build-target.mjs';
import { classifyVerification } from '../../../scripts/ci-plan.mjs';
import { verificationCommands, runVerification } from '../../../scripts/verify.mjs';

describe('CI build coverage equivalence', () => {
  it.each(['src/pages/api/v1/example.ts', 'apps/worker/entry.ts', 'tests/e2e/payments.spec.ts', '.github/workflows/ci.yml', 'src/lib/config/verification-plan.test.ts'])('still compiles both web graphs for full verification: %s', file => {
    const mode = classifyVerification([file]).mode;
    expect(mode).toBe('full');
    expect(targets.ciBuildTargets([file], mode)).toEqual(expect.arrayContaining(['site', 'app']));
    expect(targets.ciBuildTargets([file], mode).includes('worker')).toBe(targets.classifyTargetChanges([file]).includes('worker'));
  });
  it('keeps low-risk selection and production deployment selection separate', () => {
    expect(targets.ciBuildTargets(['docs/notes.md'], 'docs')).toEqual([]);
    expect(targets.ciBuildTargets(['src/content/blog/post.md'], 'content')).toEqual(['site']);
    expect(targets.ciBuildTargets(['src/styles/global.css'], 'ui')).toEqual(['site']);
    expect(targets.classifyTargetChanges(['apps/worker/entry.ts'])).toEqual(['worker']);
    expect(targets.classifyTargetChanges(['.github/workflows/ci.yml'])).toEqual([]);
    for (const files of [null, [], ['unknown.input'], ['package-lock.json']]) expect(targets.ciBuildTargets(files, 'full')).toEqual(['site', 'app', 'worker']);
  });
  it('retains audit, coverage, lint, types, image preparation and all browser suites without a second CI build', () => {
    const commands = verificationCommands('full', true);
    for (const required of ['audit:dependencies', 'test:coverage', 'lint:code', 'typecheck', 'images:optimize', 'test:e2e', 'test:components']) expect(commands).toContain(required);
    expect(commands).not.toContain('build'); expect(commands).not.toContain('verify');
    const calls: string[][] = [];
    runVerification('full', { ci: true, npmPath: 'npm-cli.js', env: { CI: 'true' }, execute: ((_node: string, args: string[]) => { calls.push(args); return { status: 0 }; }) as never });
    expect(calls.map(args => args[2])).toEqual(commands);
    expect(verificationCommands('release')).toContain('build');
    expect(verificationCommands('full')).toContain('build');
  });
  it.each(['site', 'app'])('rejects unoptimized HTML in the actual %s artifact before upload', target => {
    const root = mkdtempSync(path.join(tmpdir(), 'ci-artifact-images-'));
    try {
      const output = path.join(root, 'dist-target', target);
      const html = target === 'site' ? output : path.join(output, '.vercel/output/static');
      mkdirSync(html, { recursive: true });
      if (target === 'app') {
        writeFileSync(path.join(output, '.vercel/output/config.json'), '{"version":3,"routes":[]}');
        mkdirSync(path.join(root, 'output/build-target-reports'), { recursive: true });
        writeFileSync(path.join(root, 'output/build-target-reports/app.json'), '{"routes":[{"pattern":"/app/image"}]}');
      }
      const index = path.join(html, 'index.html');
      writeFileSync(index, '<img src="/uploads/original.png">');
      expect(() => targets.validateBuildArtifact(root, target)).toThrow('responsive WebP');
      writeFileSync(index, '<picture><source srcset="/generated/uploads/original.png-480.webp"><img src="/uploads/original.png"></picture>');
      expect(() => targets.validateBuildArtifact(root, target)).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('keeps both mandatory workflows present and makes failed selected artifacts block the required context', () => {
    const read = (file: string) => YAML.parse(readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'));
    const ci = read('.github/workflows/ci.yml'), builds = read('.github/workflows/build-targets.yml');
    expect(ci.name).toBe('CI'); expect(ci.jobs.verify).toBeDefined();
    expect(ci.on).toHaveProperty('pull_request'); expect(builds.on).toHaveProperty('pull_request');
    expect(builds.jobs.required.name).toBe('Required target artifacts');
    expect(builds.jobs.required.if).toBe('always()'); expect(builds.jobs.required.needs).toEqual(['targets', 'build']);
    expect(builds.jobs.targets.steps.find((s: { id?: string }) => s.id === 'plan').run).toContain('build-target.mjs ci-changes');
    expect(builds.jobs.build.steps.find((s: { uses?: string }) => s.uses?.startsWith('actions/upload-artifact')).with['if-no-files-found']).toBe('error');
    for (const result of ['failure', 'cancelled', 'skipped']) expect(() => targets.assertRequiredTargetBuilds(['site', 'app'], result, 'success')).toThrow();
    expect(() => targets.assertRequiredTargetBuilds(['site', 'app'], 'success', 'failure')).toThrow();
  });
});
