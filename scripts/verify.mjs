import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const full = ['test:coverage', 'lint:code', 'build', 'test:e2e', 'test:components'];
const uiTests = 'test -- src/layouts src/lib/content/blog-layout.test.ts src/lib/content/site-visual-system.test.ts src/lib/content/landing-pages.test.ts src/lib/content/homepage.test.ts src/lib/content/item-visibility.test.ts';

/** Shared commands, not authorization: CI still recomputes its immutable Git change plan. */
export function verificationCommands(mode, ci = false) {
  if (ci && mode === 'docs') return [];
  if (ci && mode === 'content') return ['content:validate', 'test -- src/lib/content src/lib/build/content-ci.test.ts'];
  // Required target artifacts compiles both web graphs for this lane. Keep every
  // non-build check here, including types and the assets needed by dev-server E2E.
  if (ci && mode === 'full') return ['audit:dependencies', 'test:coverage', 'lint:code', 'typecheck', 'images:optimize', 'test:e2e', 'test:components'];
  const plans = {
    fast: ['content:validate', 'test'],
    content: ['content:validate', 'test -- src/lib/content', 'typecheck', 'build:site', 'verify:responsive-images -- dist-target/site'],
    ui: ['images:optimize', uiTests, 'test:e2e -- tests/e2e/site-quality.spec.ts'],
    full,
    release: ['audit:dependencies', 'site:validate', ...full],
    deploy: ['site:validate', 'test:coverage', 'lint:code', 'build'],
  };
  if (!Object.hasOwn(plans, mode)) throw new Error('Unknown verification mode');
  return [...plans[mode]];
}

export function runVerification(mode, { ci = false, npmPath = process.env.npm_execpath, execute = spawnSync, env = process.env } = {}) {
  const commands = verificationCommands(mode, ci);
  if (commands.length && !npmPath) throw new Error('Run verification through npm run');
  for (const command of commands) {
    const [script, ...args] = command.split(' ');
    // Bound local resource use on every OS without changing CI coverage or assertions.
    if (!env.CI && ['test', 'test:coverage', 'test:e2e'].includes(script)) {
      if (!args.includes('--')) args.unshift('--');
      args.push(script === 'test:e2e' ? '--workers=2' : '--maxWorkers=2');
    }
    const result = execute(process.execPath, [npmPath, 'run', script, ...args], { cwd: root, env, stdio: 'inherit', shell: false });
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
