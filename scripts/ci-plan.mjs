import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Always run the required job. Workflow path filters can leave required checks pending:
// https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
export function classifyVerification(files) {
  const full = (reason) => ({ mode: 'full', reason, browser: true });
  if (!Array.isArray(files) || !files.length) return full('missing or empty change range');
  const kinds = new Set();
  for (const raw of files) {
    if (typeof raw !== 'string' || /(^|[/\\])\.\.([/\\]|$)|^[/\\]|[\r\n\0]/.test(raw)) return full('invalid path');
    const file = raw.replaceAll('\\', '/');
    if (/^(?:docs\/.+\.md|README\.md|AGENTS\.md|CONTRIBUTING\.md)$/.test(file)) continue;
    if (/^src\/content\/(?:blog\/[^/]+\.md|landing-pages\/[^/]+\.json)$/.test(file)
      || /^public\/uploads\/.+\.(?:png|jpe?g|webp|gif|avif)$/i.test(file)) kinds.add('content');
    else if (/^src\/styles\/(?:global|home-blueprint|home-integration|tool-landing)\.css$/.test(file)) kinds.add('ui');
    else return full(`requires complete verification: ${file}`);
  }
  if (kinds.size > 1) return full('mixed risk categories');
  const mode = [...kinds][0] ?? 'docs';
  return { mode, reason: 'allowlisted change range', browser: mode === 'ui' };
}

export function verificationCommands(mode) {
  if (mode === 'docs') return [];
  if (mode === 'content') return ['content:validate', 'test -- src/lib/content src/lib/build/content-ci.test.ts'];
  if (mode === 'ui') return ['check:ui'];
  if (mode === 'full') return ['audit:dependencies', 'verify'];
  throw new Error('Unknown verification mode');
}

export function changedFiles(base, head) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? '') || /^0+$/.test(base)) return null;
  // NUL-delimited names include both sides of renames; deleted executable paths cannot hide.
  const result = spawnSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head, '--'], { encoding: 'utf8', shell: false });
  return result.status === 0 ? result.stdout.split('\0').filter(Boolean) : null;
}

function requireSuccess(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`Verification command failed: ${path.basename(command)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const plan = classifyVerification(changedFiles(process.env.BASE_SHA, process.env.HEAD_SHA));
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    if (process.argv[2] === 'plan') {
      if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required for workflow planning');
      appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nbrowser=${plan.browser}\n`);
    } else if (process.argv[2] === 'run') {
      if (plan.mode === 'docs') requireSuccess('git', ['diff', '--check', process.env.BASE_SHA, process.env.HEAD_SHA, '--']);
      else {
        if (!process.env.npm_execpath) throw new Error('Run through npm run ci:verify');
        for (const command of verificationCommands(plan.mode)) requireSuccess(process.execPath, [process.env.npm_execpath, 'run', ...command.split(' ')]);
      }
    } else throw new Error('Usage: ci-plan.mjs plan|run');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
