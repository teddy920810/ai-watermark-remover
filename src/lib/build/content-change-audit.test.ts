import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { planVerification } from '../../../scripts/ci-plan.mjs';
import { readContentVersions } from '../../../scripts/lib/content-ci-versions.mjs';
import { parseEntry } from '../content-api/validation';
import { assertCmsPublication } from '../../../scripts/cms-publication.mjs';

const roots: string[] = [];
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const id = 'a'.repeat(24);
const entryPath = 'src/content/blog/isolated-draft.md';
const auditPath = `.content-api/${id}.json`;
function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'content-audit-test-')); roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const put = (file: string, value: string | Buffer) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), value); };
  git('init', '-q'); git('config', 'user.name', 'Local fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
  put('README.md', 'Fixture'); put('tests/fixtures/seo-content-baseline.json', JSON.stringify({ files: [] }));
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  const document = JSON.parse(readFileSync(new URL('../../../docs/examples/content-api/blog.json', import.meta.url), 'utf8'));
  document.data.slug = 'isolated-draft'; document.data.draft = true;
  const entry = `---\n${YAML.stringify(document.data)}---\n${document.body}`;
  put(entryPath, entry);
  const record = { version: 1, id, title: 'Unpublished fixture', actor: 'test-editor', baseRevision: base, createdAt: '2026-11-01T00:00:00.000Z', entries: [entryPath], assets: [] as Record<string, unknown>[], events: { [sha('key')]: { fingerprint: sha('request'), result: {} } }, pull: 123, approval: { digest: sha(JSON.stringify([[entryPath, sha(entry)]])), actor: 'test-editor', reference: 'https://github.com/teddy920810/ai-watermark-remover/pull/123#issuecomment-123', note: 'Approved only as an unpublished acceptance fixture.' } };
  const commit = () => { put(auditPath, JSON.stringify(record)); git('add', '.'); git('commit', '-qm', 'change'); return git('rev-parse', 'HEAD'); };
  return { cwd, git, put, base, record, commit };
}
let current: ReturnType<typeof fixture>;
beforeEach(() => { current = fixture(); });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('single content change audit closure from immutable Git objects', () => {
  it('selects content for a legitimate new draft, and ignores mutable working files', async () => {
    const f = current; const head = f.commit();
    f.put(entryPath, '<script>uncommitted</script>');
    expect((await planVerification(f.base, head, f.cwd)).mode).toBe('content');
  });
  it.each(['digest', 'unknown', 'entries', 'events', 'reference', 'base'])('does not trust malformed or stale metadata: %s', async field => {
    const f = current;
    if (field === 'digest') f.record.approval.digest = 'b'.repeat(64);
    if (field === 'unknown') Object.assign(f.record, { mode: 'content' });
    if (field === 'entries') f.record.entries.push(entryPath);
    if (field === 'events') Object.assign(f.record.events[sha('key')], { approved: true });
    if (field === 'reference') f.record.approval.reference = 'https://example.com/approved';
    if (field === 'base') f.record.baseRevision = 'f'.repeat(40);
    expect((await planVerification(f.base, f.commit(), f.cwd)).mode).toBe('full');
  });
  it.each(['src/lib/auth.ts', 'tests/fixtures/seo-content-baseline.json', `.content-api/${'b'.repeat(24)}.json`, 'public/uploads/extra.png', 'src/content/blog/unlisted.md'])('escalates mixed or unlisted paths: %s', async file => {
    const f = current; f.put(file, '{}');
    expect((await planVerification(f.base, f.commit(), f.cwd)).mode).toBe('full');
  });
  it('does not give protected baseline records a fast path even without a baseline edit', async () => {
    const f = current;
    f.git('reset', '--hard', f.base);
    f.put('tests/fixtures/seo-content-baseline.json', JSON.stringify({ files: [{ file: entryPath }] }));
    f.git('add', '.'); f.git('commit', '-qm', 'protected baseline'); f.base = f.git('rev-parse', 'HEAD'); f.record.baseRevision = f.base;
    const doc = JSON.parse(readFileSync(new URL('../../../docs/examples/content-api/blog.json', import.meta.url), 'utf8')); doc.data.slug = 'isolated-draft';
    const text = `---\n${YAML.stringify(doc.data)}---\n${doc.body}`; f.put(entryPath, text); f.record.approval.digest = sha(JSON.stringify([[entryPath, sha(text)]]));
    expect((await planVerification(f.base, f.commit(), f.cwd)).mode).toBe('full');
  });
  it('rejects deletion and symlink object modes without following them', async () => {
    const f = current; const first = f.commit();
    f.git('rm', entryPath); f.git('commit', '-qm', 'deleted');
    expect((await planVerification(first, f.git('rev-parse', 'HEAD'), f.cwd)).mode).toBe('full');
    f.git('reset', '--hard', first);
    f.git('mv', entryPath, 'src/content/blog/renamed-draft.md'); f.git('commit', '-qm', 'renamed');
    expect((await planVerification(first, f.git('rev-parse', 'HEAD'), f.cwd)).mode).toBe('full');
    f.git('reset', '--hard', first);
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.cwd, input: '../../outside', encoding: 'utf8' }).trim();
    f.git('update-index', '--cacheinfo', `120000,${blob},${entryPath}`); f.git('commit', '-qm', 'symlink');
    expect((await planVerification(f.base, f.git('rev-parse', 'HEAD'), f.cwd)).mode).toBe('full');
  });
  it('recomputes original asset bytes and digest rather than trusting the audit', async () => {
    const f = current; const bytes = Buffer.from('original-byte-fixture'); const hash = sha(bytes);
    const asset = { path: `/uploads/content-api/${id}/source-${hash.slice(0, 16)}.png`, sha256: hash, width: 40, height: 30, bytes: bytes.length, mime: 'image/png' };
    f.record.assets.push(asset); f.put(`public${asset.path}`, bytes);
    const entryHash = f.record.approval.digest; // Recompute in the same service ordering.
    expect(entryHash).toHaveLength(64);
    const text = readFileSync(path.join(f.cwd, entryPath));
    f.record.approval.digest = sha(JSON.stringify([[entryPath, sha(text)], [asset.path, hash]].sort(([a], [b]) => a.localeCompare(b))));
    const good = f.commit(); expect((await planVerification(f.base, good, f.cwd)).mode).toBe('content');
    f.put(`public${asset.path}`, Buffer.from('changed')); const bad = f.commit();
    expect((await planVerification(f.base, bad, f.cwd)).mode).toBe('full');
  });
  it('loads the preinstall classifier with no dependency directory', () => {
    const f = current;
    f.put('scripts/ci-plan.mjs', readFileSync(new URL('../../../scripts/ci-plan.mjs', import.meta.url)));
    const source = readFileSync(new URL('../../../scripts/ci-plan.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import .* from ['"](?:yaml|sharp|zod|vite)/m);
    const result = execFileSync(process.execPath, ['scripts/ci-plan.mjs', 'plan'], { cwd: f.cwd, env: { ...process.env, BASE_SHA: f.base, HEAD_SHA: f.base, GITHUB_OUTPUT: path.join(f.cwd, 'plan.txt') }, encoding: 'utf8' });
    expect(result).toContain('full');
  });
  it('compares legacy presets with the real base entry, never with the candidate itself', () => {
    const f = current; const file = 'src/content/landing-pages/legacy-example.json';
    const doc = JSON.parse(readFileSync(new URL('../../../docs/examples/content-api/landing.json', import.meta.url), 'utf8')); doc.data.slug = 'legacy-example';
    doc.data.features.items[0].comparison = { watermark: 'original readonly preset' };
    f.put(file, JSON.stringify(doc.data)); f.git('add', '.'); f.git('commit', '-qm', 'legacy base'); const base = f.git('rev-parse', 'HEAD');
    doc.data.features.items[0].comparison.watermark = 'new illustrative watermark';
    f.put(file, JSON.stringify(doc.data)); f.git('add', '.'); f.git('commit', '-qm', 'changed legacy'); const head = f.git('rev-parse', 'HEAD');
    const versions = readContentVersions(base, head, file, f.cwd);
    expect(versions.previous?.data).toMatchObject({ features: { items: [{ comparison: { watermark: 'original readonly preset' } }] } });
    expect(() => parseEntry('landing', versions.current, 'legacy-example', versions.previous)).toThrow();
  });
  it('does not isolate a malformed draft JSON from the global publication guard', () => {
    const f = current; mkdirSync(path.join(f.cwd, 'src/content/landing-pages'), { recursive: true });
    f.put('src/content/landing-pages/broken.json', '{"draft":true,');
    expect(() => assertCmsPublication(f.cwd)).toThrow();
  });
  it('keeps an existing publication audit ID out of the new-change fast path', async () => {
    const f = current; const base = f.commit();
    const changed = readFileSync(path.join(f.cwd, entryPath), 'utf8') + '\nA later draft edit.\n';
    f.put(entryPath, changed);
    f.record.pull = 124; f.record.approval.reference = 'https://github.com/teddy920810/ai-watermark-remover/pull/124#issuecomment-456';
    f.record.approval.digest = sha(JSON.stringify([[entryPath, sha(changed)]]));
    expect((await planVerification(base, f.commit(), f.cwd)).mode).toBe('full');
  });
});
