import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const full = ['test:coverage', 'lint:code', 'build', 'test:e2e', 'test:components'];
const ciChecks = ['audit:dependencies', 'test:coverage', 'lint:code', 'typecheck'];
const uiTests = 'test -- src/layouts src/lib/content/blog-layout.test.ts src/lib/content/site-visual-system.test.ts src/lib/content/landing-pages.test.ts src/lib/content/homepage.test.ts src/lib/content/item-visibility.test.ts';
const uiE2E = 'test:e2e -- tests/e2e/accessibility.spec.ts tests/e2e/site-quality.spec.ts';
const imageDisplayE2E = [
  uiE2E,
  'tests/e2e/image-display-frames.spec.ts',
  'tests/e2e/home-comparison-demo.spec.ts',
  'tests/e2e/home-results-pairs.spec.ts',
  'tests/e2e/home-features-pairs.spec.ts',
  'tests/e2e/nano-banana-comparisons.spec.ts',
  'tests/e2e/tool-landing.spec.ts',
].join(' ');

/** Shared commands, not authorization: CI still recomputes its immutable Git change plan. */
export function verificationCommands(mode, ci = false, { part = 'all', imageDisplay = false } = {}) {
  if (part !== 'all' && part !== 'checks') {
    if (!ci || mode !== 'full' || !['1/2', '2/2'].includes(part)) throw new Error(`Invalid verification shard: ${part}`);
    return ['images:optimize', `test:e2e -- --shard=${part}`];
  }
  if (ci && mode === 'docs') return [];
  if (ci && mode === 'content') return ['content:validate', 'test -- src/lib/content src/lib/build/content-ci.test.ts'];
  if (ci && mode === 'ui' && !imageDisplay) return ['images:optimize', uiTests, uiE2E];
  // Required target artifacts compiles both web graphs for this lane. Keep every
  // non-build check here, including types and the assets needed by dev-server E2E.
  if (ci && mode === 'full') {
    const e2e = part === 'checks' ? [] : ['test:e2e'];
    return [...ciChecks, 'images:optimize', ...e2e, 'test:components'];
  }
  const plans = {
    fast: ['content:validate', 'test'],
    content: ['content:validate', 'test -- src/lib/content', 'typecheck', 'build:site', 'verify:responsive-images -- dist-target/site'],
    ui: ['images:optimize', 'typecheck', `${uiTests} src/lib/home-interactions.test.ts src/lib/landing-interactions.test.ts`, imageDisplayE2E, 'test:components'],
    full,
    release: ['audit:dependencies', 'site:validate', ...full],
    deploy: ['site:validate', 'test:coverage', 'lint:code', 'build'],
  };
  if (!Object.hasOwn(plans, mode)) throw new Error('Unknown verification mode');
  return [...plans[mode]];
}

export function runVerification(mode, { ci = false, part, imageDisplay, npmPath = process.env.npm_execpath, execute = spawnSync, env = process.env } = {}) {
  const commands = verificationCommands(mode, ci, { part, imageDisplay });
  if (commands.length && !npmPath) throw new Error('Run verification through npm run');
  for (const command of commands) {
    const [script, ...args] = command.split(' ');
    // Bound local resource use on every OS without changing CI coverage or assertions.
    if (!env.CI && ['test', 'test:coverage', 'test:e2e'].includes(script)) {
      if (!args.includes('--')) args.unshift('--');
      args.push(script === 'test:e2e' ? '--workers=2' : '--maxWorkers=2');
    }
    const startedAt = performance.now();
    const result = execute(process.execPath, [npmPath, 'run', script, ...args], { cwd: root, env, stdio: 'inherit', shell: false });
    if (ci) process.stdout.write(`${command}: ${((performance.now() - startedAt) / 1000).toFixed(1)}s\n`);
    if (result.error || result.status !== 0) throw new Error(`Verification failed: ${command}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, option, ...extra] = process.argv.slice(2);
    if (extra.length || option && option !== '--plan') throw new Error('Usage: verify.mjs fast|content|ui|full|release|deploy [--plan]');
    if (option === '--plan') process.stdout.write(`${JSON.stringify(verificationCommands(mode), null, 2)}\n`);
    else runVerification(mode);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
