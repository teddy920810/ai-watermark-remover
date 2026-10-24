/* global console, process */
import { copyFile, lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function workerPaths(options) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const directory = resolve(cwd, options.outDir ?? 'output/worker');
  const location = relative(cwd, directory);
  if (!location || location.startsWith('..') || isAbsolute(location)) throw new Error('Worker output must stay inside the workspace');
  return { cwd, directory };
}
export async function buildWorker(options = {}) {
  const { cwd, directory } = workerPaths(options);
  const build = options.buildImpl ?? (await import('esbuild')).build;
  await mkdir(directory, { recursive: true });
  const entry = join(directory, 'entry.mjs');
  const result = await build({
    absWorkingDir: cwd, entryPoints: [join(cwd, 'apps', 'worker', 'entry.ts')], outfile: entry,
    bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external',
    metafile: true, sourcemap: false, logLevel: 'warning',
  });
  const inputs = Object.keys(result.metafile?.inputs ?? {}).sort();
  if (inputs.some((input) => input.endsWith('.astro') || input.includes('astro:env'))) throw new Error('Worker bundle must not depend on the content-site runtime');
  await writeFile(join(directory, 'build-manifest.json'), `${JSON.stringify({ version: 1, runtime: 'node24', entry: 'entry.mjs', format: 'esm', packages: 'external', inputs }, null, 2)}\n`);
  return { entry, manifest: join(directory, 'build-manifest.json') };
}

/** Copy a fixed set of server build files, never the checkout or local secrets. */
export async function prepareWorkerContext(options = {}) {
  const { cwd, directory: bundle } = workerPaths(options);
  const files = [
    [join(cwd, 'package.json'), 'package.json'],
    [join(cwd, 'package-lock.json'), 'package-lock.json'],
    [join(cwd, 'apps', 'worker', 'Dockerfile'), 'Dockerfile'],
    [join(cwd, 'apps', 'worker', 'Dockerfile.dockerignore'), '.dockerignore'],
    [join(bundle, 'entry.mjs'), 'output/worker/entry.mjs'],
    [join(bundle, 'build-manifest.json'), 'output/worker/build-manifest.json'],
  ];
  for (const [source] of files) {
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Worker build inputs must be regular files');
  }
  const outputRoot = join(cwd, 'output');
  await mkdir(outputRoot, { recursive: true });
  const outputLocation = relative(await realpath(cwd), await realpath(outputRoot));
  if (!outputLocation || outputLocation.startsWith('..') || isAbsolute(outputLocation)) throw new Error('Worker context must stay inside the workspace');
  const directory = await mkdtemp(join(outputRoot, 'worker-context-'));
  for (const [source, target] of files) {
    const destination = join(directory, target);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  // gcloud ignores source before Docker reads .dockerignore. Keep its independent
  // upload allowlist explicit; never inherit a checkout's ignored output/ rule.
  // https://docs.cloud.google.com/sdk/gcloud/reference/builds/submit
  await writeFile(join(directory, '.gcloudignore'), '*\n!Dockerfile\n!.dockerignore\n!.gcloudignore\n!package.json\n!package-lock.json\n!output\noutput/*\n!output/worker\noutput/worker/*\n!output/worker/entry.mjs\n!output/worker/build-manifest.json\n');
  return { directory };
}
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    await buildWorker();
    const context = await prepareWorkerContext();
    console.log(`Standalone worker bundle created. Minimal Docker context: ${context.directory}`);
  }
  catch { console.error('Worker build failed. Check the source and dependency configuration.'); process.exitCode = 1; }
}
