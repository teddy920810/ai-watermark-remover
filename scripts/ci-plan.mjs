import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  if (mode === 'ui') return ['images:optimize', 'check:ui'];
  if (mode === 'full') return ['audit:dependencies', 'verify'];
  throw new Error('Unknown verification mode');
}

export function changedFiles(base, head, cwd = process.cwd()) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? '') || /^0+$/.test(base)) return null;
  // NUL-delimited names include both sides of renames; deleted executable paths cannot hide.
  const result = spawnSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head, '--'], { cwd, encoding: 'utf8', shell: false });
  return result.status === 0 ? result.stdout.split('\0').filter(Boolean) : null;
}

// Preinstall planning uses only Node builtins and immutable Git objects. This is
// a content-scope proof, never an authorization or protected-baseline exemption.
export function planVerification(base, head, cwd = process.cwd()) {
  const files = changedFiles(base, head, cwd);
  if (files?.length) {
    const raw = spawnSync('git', ['diff', '--no-renames', '--no-abbrev', '--raw', '-z', base, head, '--'], { cwd, shell: false, encoding: 'utf8' });
    const rows = raw.stdout?.split('\0').filter(Boolean) ?? [];
    if (raw.error || raw.status !== 0 || rows.length !== files.length * 2 || rows.some((row, index) => index % 2 === 0 && !/^:(?:000000|100644) 100644 [a-f0-9]{40} [a-f0-9]{40} [AM]$/.test(row))) {
      return { mode: 'full', reason: 'deleted, renamed or nonregular Git inputs', browser: true };
    }
  }
  const auditFiles = files?.filter(file => file.startsWith('.content-api/')) ?? [];
  if (!auditFiles.length) return classifyVerification(files);
  const full = reason => ({ mode: 'full', reason, browser: true });
  if (auditFiles.length !== 1 || !/^\.content-api\/[a-f0-9]{24}\.json$/.test(auditFiles[0])) return full('unknown content audit path');
  const content = files.filter(file => file !== auditFiles[0]);
  if (classifyVerification(content).mode !== 'content') return full('mixed content audit scope');
  try {
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd, shell: false, maxBuffer: 4_000_000 });
      if (result.error || result.status !== 0) throw new Error('Git object read failed');
      return result.stdout;
    };
    const assert = value => { if (!value) throw new Error('Content audit closure is invalid'); };
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const hex = (value, size) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
    const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max && [...value].every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127);
    const exact = (value, keys, required = keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(value, key));
    const read = (ref, file) => git('show', `${ref}:${file}`);
    const tree = ref => new Map(git('ls-tree', '-r', '-z', ref).toString().split('\0').filter(Boolean).map(row => {
      const tab = row.indexOf('\t'); return [row.slice(tab + 1), row.slice(0, tab).split(' ')];
    }));
    const baseTree = tree(base); const headTree = tree(head);
    for (const file of files) assert(headTree.get(file)?.[0] === '100644' && headTree.get(file)?.[1] === 'blob' && (!baseTree.has(file) || baseTree.get(file)?.[0] === '100644'));
    // Renames appear as deletion + addition and fail the regular-head-file rule.
    const record = JSON.parse(read(head, auditFiles[0]).toString());
    const id = auditFiles[0].slice(13, -5);
    assert(exact(record, ['version', 'id', 'title', 'actor', 'baseRevision', 'createdAt', 'entries', 'assets', 'events', 'pull', 'approval']));
    assert(record.version === 1 && record.id === id && text(record.title, 1, 180) && text(record.actor, 1, 180) && hex(record.baseRevision, 40));
    assert(typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt)) && new Date(record.createdAt).toISOString() === record.createdAt);
    git('merge-base', '--is-ancestor', record.baseRevision, base);
    assert(Number.isSafeInteger(record.pull) && record.pull > 0);
    assert(exact(record.approval, ['digest', 'actor', 'reference', 'note']) && hex(record.approval.digest, 64) && record.approval.actor === record.actor && text(record.approval.note, 20, 2000));
    assert(new RegExp(`^https://github\\.com/teddy920810/ai-watermark-remover/pull/${record.pull}#issuecomment-[1-9][0-9]*$`).test(record.approval.reference));
    assert(Array.isArray(record.entries) && record.entries.length > 0 && record.entries.length <= 20 && new Set(record.entries).size === record.entries.length);
    assert(record.entries.every(file => typeof file === 'string' && /^src\/content\/(?:blog\/[a-z0-9]+(?:-[a-z0-9]+)*\.md|landing-pages\/[a-z0-9]+(?:-[a-z0-9]+)*\.json)$/.test(file)));
    const baseline = JSON.parse(read(base, 'tests/fixtures/seo-content-baseline.json').toString());
    assert(Array.isArray(baseline.files) && !record.entries.some(file => baseline.files.some(row => row.file === file)));
    assert(Array.isArray(record.assets) && record.assets.length <= 30);
    const assetValid = asset => exact(asset, ['path', 'sha256', 'width', 'height', 'bytes', 'mime']) && hex(asset.sha256, 64)
      && new RegExp(`^/uploads/content-api/${id}/[a-z0-9]+(?:-[a-z0-9]+)*-${asset.sha256.slice(0, 16)}\\.(?:jpg|png|webp)$`).test(asset.path)
      && ['width', 'height', 'bytes'].every(key => Number.isSafeInteger(asset[key]) && asset[key] > 0)
      && asset.width <= 6000 && asset.height <= 6000 && asset.width * asset.height <= 24_000_000 && asset.bytes <= 2_000_000
      && ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[asset.path.split('.').at(-1)] === asset.mime;
    assert(record.assets.every(assetValid) && new Set(record.assets.map(asset => asset.path)).size === record.assets.length);
    assert(exact(record.events, Object.keys(record.events)) && Object.keys(record.events).length > 0 && Object.keys(record.events).length <= 200);
    for (const [key, event] of Object.entries(record.events)) {
      assert(hex(key, 64) && exact(event, ['fingerprint', 'result'], ['fingerprint']) && hex(event.fingerprint, 64));
      if (event.result !== undefined) {
        assert(exact(event.result, ['asset'], []));
        if (event.result.asset !== undefined) assert(assetValid(event.result.asset) && record.assets.some(asset => JSON.stringify(asset) === JSON.stringify(event.result.asset)));
      }
    }
    const expected = new Set([...record.entries, ...record.assets.map(asset => `public${asset.path}`), auditFiles[0]]);
    assert(files.length === expected.size && files.every(file => expected.has(file)));
    const pairs = record.entries.map(file => [file, hash(read(head, file))]);
    for (const asset of record.assets) { const bytes = read(head, `public${asset.path}`); assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256); pairs.push([asset.path, asset.sha256]); }
    assert(hash(JSON.stringify(pairs.sort(([a], [b]) => a.localeCompare(b)))) === record.approval.digest);
    return { mode: 'content', reason: 'verified single content change audit and exact Git closure', browser: false };
  } catch { return full('unverified content audit; complete verification required'); }
}

function requireSuccess(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`Verification command failed: ${path.basename(command)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const plan = planVerification(process.env.BASE_SHA, process.env.HEAD_SHA);
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
