import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

/** @param {{ root: string, registeredRoot: string, origin: string, changedPaths: string[], classifiedPaths?: string[], readOnly?: boolean }} state */
export function validateWorkspace({ root, registeredRoot, origin, changedPaths, classifiedPaths = [], readOnly = false }) {
  const issues = [];
  if (!registeredRoot) issues.push('Local workspace registration is required (AI_WATERMARK_PROJECT_ROOT or the Codex project registry).');
  else if (path.relative(path.resolve(root), path.resolve(registeredRoot))) issues.push('Execution directory does not match the registered maintenance root.');
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)teddy920810\/ai-watermark-remover(?:\.git)?$/.test(origin)) issues.push('Unexpected canonical repository origin.');
  if (!readOnly) for (const file of changedPaths) if (!classifiedPaths.includes(file)) issues.push(`unclassified change: ${file}`);
  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const git = (...argv) => execFileSync('git', argv, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const root = realpathSync(git('rev-parse', '--show-toplevel'));
    const registry = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'skills/codex-project-delivery/references/projects.local.json');
    const registeredRoot = process.env.AI_WATERMARK_PROJECT_ROOT || (existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8')).paths?.['ai-watermark-remove'] : '');
    const index = args.indexOf('--classified');
    const classifiedPaths = index >= 0 ? JSON.parse(readFileSync(args[index + 1], 'utf8')).paths : [];
    if (!Array.isArray(classifiedPaths) || !classifiedPaths.every(file => typeof file === 'string')) throw new Error('Classification must contain an explicit paths array.');
    const changedPaths = [...new Set([...git('diff', '--name-only', 'HEAD', '-z').split('\0'), ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')].filter(Boolean))];
    const origin = git('remote', 'get-url', 'origin');
    const issues = validateWorkspace({ root, registeredRoot: registeredRoot ? realpathSync(registeredRoot) : '', origin, changedPaths, classifiedPaths, readOnly: args.includes('--read-only') });
    if (path.relative(root, realpathSync(process.cwd()))) issues.push('Start from the registered repository root.');
    console.log(JSON.stringify({ root, origin, branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'), divergence: git('rev-list', '--left-right', '--count', 'HEAD...origin/main'), changedPaths, issues }, null, 2));
    process.exitCode = issues.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
