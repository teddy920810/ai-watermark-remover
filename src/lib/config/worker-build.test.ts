import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorker, prepareWorkerContext } from '../../../scripts/build-worker.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
describe('standalone worker packaging', () => {
  async function contextFixture() {
    const directory = await mkdtemp(join(tmpdir(), 'watermark-worker-context-')); directories.push(directory);
    await mkdir(join(directory, 'apps', 'worker'), { recursive: true });
    await mkdir(join(directory, 'output', 'worker'), { recursive: true });
    const files = {
      'package.json': '{"private":true}', 'package-lock.json': '{"lockfileVersion":3}',
      'apps/worker/Dockerfile': 'FROM node:24.22.1-bookworm-slim', 'apps/worker/Dockerfile.dockerignore': '*\n!package.json\n',
      'output/worker/entry.mjs': 'export const runWorker = () => {};', 'output/worker/build-manifest.json': '{"version":1}',
      '.env.local': 'NEVER_UPLOAD_PRIVATE_VALUE=example', 'output/private-sample.jpg': 'private sample bytes',
    };
    await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(directory, name), contents)));
    return directory;
  }
  async function relativeFiles(directory: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(join(directory, prefix), { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => entry.isDirectory() ? relativeFiles(directory, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]));
    return files.flat().sort();
  }
  it('prepares a fresh minimal upload directory containing only the worker allowlist', async () => {
    const directory = await contextFixture();
    const result = await prepareWorkerContext({ cwd: directory });
    expect(await relativeFiles(result.directory)).toEqual(['.dockerignore', '.gcloudignore', 'Dockerfile', 'output/worker/build-manifest.json', 'output/worker/entry.mjs', 'package-lock.json', 'package.json']);
    expect(await readFile(join(result.directory, 'output/worker/entry.mjs'), 'utf8')).toBe('export const runWorker = () => {};');
    expect(await readFile(join(result.directory, '.gcloudignore'), 'utf8')).not.toContain('.gitignore');
    const repeated = await prepareWorkerContext({ cwd: directory });
    expect(repeated.directory).not.toBe(result.directory);
  });
  it('refuses outside bundle paths and non-file inputs instead of recursively copying arbitrary content', async () => {
    const directory = await contextFixture();
    await expect(prepareWorkerContext({ cwd: directory, outDir: '../outside' })).rejects.toThrow('Worker output must stay inside the workspace');
    await rm(join(directory, 'output', 'worker', 'entry.mjs'));
    await mkdir(join(directory, 'output', 'worker', 'entry.mjs'));
    await expect(prepareWorkerContext({ cwd: directory })).rejects.toThrow('Worker build inputs must be regular files');
  });
  it('bundles only the server entry for Node24 and keeps native/package dependencies external', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watermark-worker-build-')); directories.push(directory);
    const build = vi.fn().mockResolvedValue({ metafile: { inputs: {}, outputs: {} } });
    const result = await buildWorker({ cwd: directory, buildImpl: build });
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ platform: 'node', target: 'node24', format: 'esm', bundle: true, packages: 'external', entryPoints: [join(directory, 'apps', 'worker', 'entry.ts')], outfile: join(directory, 'output', 'worker', 'entry.mjs') }));
    expect(result.entry).toBe(join(directory, 'output', 'worker', 'entry.mjs'));
    expect(await readFile(join(directory, 'output', 'worker', 'build-manifest.json'), 'utf8')).not.toMatch(/access.key|secret|cookie|token/i);
  });
  it('rejects an output target outside the workspace instead of writing arbitrary paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watermark-worker-build-')); directories.push(directory);
    const build = vi.fn();
    await expect(buildWorker({ cwd: directory, outDir: '../outside-worker', buildImpl: build })).rejects.toThrow('Worker output must stay inside the workspace');
    expect(build).not.toHaveBeenCalled();
  });
  it('builds the Linux image from the bundle and manifests without copying local credentials or host node_modules', async () => {
    const dockerfile = await readFile(new URL('../../../apps/worker/Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toContain('FROM node:24.22.1-bookworm-slim');
    expect(dockerfile).toContain('ffmpeg');
    expect(dockerfile).toContain('COPY package.json package-lock.json');
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('COPY output/worker/entry.mjs');
    expect(dockerfile).not.toMatch(/COPY\s+\.\s|COPY.*node_modules|COPY.*\.env|[A-Z]:\\/);
  });
  it('limits the Docker build context to manifests and the compiled worker instead of sending private local files', async () => {
    const source = await readFile(new URL('../../../apps/worker/Dockerfile.dockerignore', import.meta.url), 'utf8');
    const rules = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    expect(rules[0]).toBe('*');
    expect(rules.filter((line) => line.startsWith('!'))).toEqual(['!package.json', '!package-lock.json', '!output', '!output/worker', '!output/worker/entry.mjs', '!output/worker/build-manifest.json']);
    expect(rules).toContain('output/*'); expect(rules).toContain('output/worker/*');
  });
});
