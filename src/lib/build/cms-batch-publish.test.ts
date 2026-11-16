import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { assertBatchHead, planBatch, publishBatch, requiredChecksReady, validateRequest } from '../../../scripts/cms-batch-publish.mjs';
import { projectContent, contentHash, contentImages } from '../../../scripts/lib/content-baseline.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'cms-batch-')); roots.push(root);
  const git = (...args: string[]) => {
    const value = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return args[0] === 'show' ? value : value.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
  const put = (file: string, text: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  put('src/content/blog/example.md', '---\nslug: example\ndraft: false\n---\nOriginal\n');
  put('src/app.ts', 'original\n'); commit(); git('branch', 'editor');
  return { git, put, commit };
}
describe('explicit CMS blog batch publication', () => {
  it('accepts only the dedicated editor and the trusted workflow revision', () => {
    const payload = { repository: { owner: 'teddy920810', repo: 'ai-watermark-remover', ref: 'codex/cms-blog-editing', sha: 'a'.repeat(40) }, action: { name: 'publish-blog-batch' } };
    expect(validateRequest(payload)).toBe('a'.repeat(40));
    expect(() => validateRequest({ ...payload, repository: { ...payload.repository, ref: 'main' } })).toThrow();
    expect(() => validateRequest({ ...payload, repository: { ...payload.repository, repo: 'other' } })).toThrow();
    expect(() => validateRequest({ ...payload, repository: { ...payload.repository, sha: '' } })).toThrow();
  });
  it('publishes a frozen content batch while preserving newer unrelated main changes', () => {
    const f = fixture(); f.git('switch', 'editor');
    f.put('src/content/blog/example.md', '---\nslug: example\ndraft: true\n---\nOriginal\n'); const source = f.commit();
    f.git('switch', 'main'); f.put('src/app.ts', 'newer production code\n'); const main = f.commit();
    const plan = planBatch({ git: f.git, source, main });
    expect(plan.files).toEqual(['src/content/blog/example.md']);
    expect(f.git('show', `${plan.tree}:src/app.ts`)).toBe('newer production code\n');
    expect(f.git('show', `${plan.tree}:src/content/blog/example.md`)).toContain('draft: true');
  });
  it.each(['.github/workflows/ci.yml', 'src/app.ts', 'public/uploads/executable.svg'])('rejects source changes outside blog/raster content: %s', file => {
    const f = fixture(); const main = f.git('rev-parse', 'HEAD'); f.git('switch', 'editor'); f.put(file, 'untrusted'); const source = f.commit();
    expect(() => planBatch({ git: f.git, source, main })).toThrow(/范围/);
  });
  it('stops on conflicting concurrent edits instead of overwriting the new main article', () => {
    const f = fixture(); f.git('switch', 'editor'); f.put('src/content/blog/example.md', 'editor version'); const source = f.commit();
    f.git('switch', 'main'); f.put('src/content/blog/example.md', 'production version'); const main = f.commit();
    expect(() => planBatch({ git: f.git, source, main })).toThrow(/冲突/);
  });
  it('treats an already merged batch as no change', () => {
    const f = fixture(); const source = f.git('rev-parse', 'HEAD'); expect(planBatch({ git: f.git, source, main: source }).files).toEqual([]);
  });
  it('requires successful trusted checks for the current exact revision, never skipped or stale checks', () => {
    const sha = 'a'.repeat(40);
    const checks = ['verify', 'Required target artifacts'].map(name => ({ name, app: { id: 15368 }, head_sha: sha, status: 'completed', conclusion: 'success' }));
    expect(requiredChecksReady(checks, sha)).toBe(true);
    expect(requiredChecksReady(checks.slice(1), sha)).toBe(false);
    expect(requiredChecksReady(checks, 'b'.repeat(40))).toBe(false);
    expect(requiredChecksReady(checks.map(c => ({ ...c, app: { id: 1 } })), sha)).toBe(false);
    expect(() => requiredChecksReady(checks.map(c => ({ ...c, conclusion: 'skipped' })), sha)).toThrow();
  });
  it('rejects a release branch tampered after the original publish approval', () => {
    const f = fixture(); f.put('tests/fixtures/seo-content-baseline.json', '{"files":[]}'); const main = f.commit();
    f.git('switch', 'editor'); f.git('merge', 'main'); f.put('src/content/blog/example.md', 'approved article'); const source = f.commit();
    expect(() => assertBatchHead({ git: f.git, main, source, head: source })).not.toThrow();
    f.put('src/app.ts', 'injected code'); const head = f.commit();
    expect(() => assertBatchHead({ git: f.git, main, source, head })).toThrow(/偏离/);
  });
  it('verifies the approved protected-content baseline including original final newlines', () => {
    const f = fixture(); const file = 'src/content/blog/example.md';
    const original = projectContent(file, f.git('show', `HEAD:${file}`));
    f.put('tests/fixtures/seo-content-baseline.json', JSON.stringify({ files: [{ file, semanticSha256: contentHash(original), images: contentImages(original) }] }, null, 2) + '\n');
    const main = f.commit(); f.git('switch', 'editor'); f.git('merge', 'main');
    f.put(file, '---\nslug: example\ndraft: true\n---\nKeep the final newline\n'); const source = f.commit();
    const changed = projectContent(file, f.git('show', `${source}:${file}`));
    f.put('tests/fixtures/seo-content-baseline.json', JSON.stringify({ files: [{ file, semanticSha256: contentHash(changed), images: contentImages(changed), contentOwnerApproval: `https://github.com/teddy920810/ai-watermark-remover/tree/${source}` }] }, null, 2) + '\n');
    const head = f.commit(); expect(() => assertBatchHead({ git: f.git, main, source, head })).not.toThrow();
  });
  it.each([false, true])('executes a frozen batch and verifies the final merged visibility (concurrent main edit: %s)', async concurrentMainEdit => {
    const f = fixture(); f.put('tests/fixtures/seo-content-baseline.json', '{"files":[]}');
    const original = '---\nslug: example\ndraft: false\n---\n' + 'Unchanged paragraph.\n'.repeat(30) + 'Original\n';
    f.put('src/content/blog/example.md', original); const main = f.commit();
    f.git('update-ref', 'refs/remotes/origin/main', main); f.git('switch', 'editor'); f.git('merge', 'main');
    f.put('src/content/blog/example.md', original.replace('Original', 'Approved').replace('draft: false', concurrentMainEdit ? 'draft: false' : 'draft: true')); const source = f.commit();
    f.put('src/content/blog/next.md', 'next batch'); const newer = f.commit();
    let snapshot = ''; let merged = false; let created = 0; let checked = false; let latestMain = main; let updated = false; let sourceReads = 0;
    const branch = `codex/cms-batch-${source}`;
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const request: typeof fetch = async (input, options) => {
      const url = String(input); const route = url.replace('https://api.github.com/repos/teddy920810/ai-watermark-remover', '');
      if (url.endsWith('/cms-build.json')) return json({ revision: snapshot });
      if (url.endsWith('/blog/example')) return new Response('Not found', { status: 404 });
      if (route === '/git/ref/heads/codex/cms-blog-editing') return json({ object: { sha: sourceReads++ === 0 ? source : newer } });
      if (route === '/git/ref/heads/main') return json({ object: { sha: latestMain } });
      if (route.startsWith('/pulls?')) return json([]);
      if (route.startsWith('/git/matching-refs')) return json([]);
      if (route === '/git/refs') { f.git('update-ref', `refs/heads/${branch}`, main); return json({}); }
      if (route === '/merges') {
        const body = JSON.parse(String(options?.body));
        if (body.base !== branch) return new Response(null, { status: 204 });
        snapshot = f.git('commit-tree', f.git('rev-parse', `${source}^{tree}`), '-p', main, '-p', source, '-m', 'snapshot');
        f.git('update-ref', `refs/heads/${branch}`, snapshot);
        return json({ sha: snapshot, commit: { tree: { sha: f.git('rev-parse', `${source}^{tree}`) } } });
      }
      if (route === '/pulls' && options?.method === 'POST') {
        created++;
        if (concurrentMainEdit) {
          f.git('switch', 'main'); f.put('src/content/blog/example.md', original.replace('draft: false', 'draft: true')); latestMain = f.commit();
          f.git('update-ref', 'refs/remotes/origin/main', latestMain);
        }
        return json({ number: 1, html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/1' });
      }
      if (route === '/pulls/1') return json({ number: 1, state: 'open', merged: false, mergeable_state: concurrentMainEdit && !updated ? 'behind' : 'clean', head: { sha: snapshot, ref: branch, repo: { full_name: 'teddy920810/ai-watermark-remover' } }, base: { ref: 'main' } });
      if (route === '/pulls/1/update-branch') {
        const tree = f.git('merge-tree', '--write-tree', latestMain, snapshot).split('\n')[0];
        snapshot = f.git('commit-tree', tree, '-p', snapshot, '-p', latestMain, '-m', 'update branch');
        f.git('update-ref', `refs/heads/${branch}`, snapshot); updated = true; return json({});
      }
      if (route.includes('/check-runs')) { checked = true; return json({ check_runs: ['verify', 'Required target artifacts'].map(name => ({ name, app: { id: 15368 }, head_sha: snapshot, status: 'completed', conclusion: 'success' })) }); }
      if (route === '/pulls/1/merge') { expect(checked).toBe(true); merged = true; return json({ merged: true, sha: snapshot }); }
      throw new Error(`Unexpected request ${route}`);
    };
    const result = await publishBatch({ payload: { action: { name: 'publish-blog-batch' }, repository: { owner: 'teddy920810', repo: 'ai-watermark-remover', ref: 'codex/cms-blog-editing', sha: main } }, token: 'test', actor: 'test-editor', runId: '1', git: (...args) => args[0] === 'fetch' ? '' : f.git(...args), request, pause: async () => {} });
    expect(result.state).toBe('published'); expect(merged).toBe(true); expect(created).toBe(1); expect(sourceReads).toBe(1);
    expect(f.git('ls-tree', snapshot, '--', 'src/content/blog/next.md')).toBe('');
  });
  it('retries merged production acceptance before syncing away the original batch identity', async () => {
    const f = fixture(); f.put('tests/fixtures/seo-content-baseline.json', '{"files":[]}'); const main = f.commit();
    f.git('switch', 'editor'); f.put('src/content/blog/example.md', '---\nslug: example\ndraft: true\n---\n' + 'Original paragraph.\n'.repeat(30)); const source = f.commit();
    const merged = f.git('commit-tree', f.git('rev-parse', `${source}^{tree}`), '-p', main, '-m', 'squashed batch');
    f.git('update-ref', 'refs/remotes/origin/main', merged);
    const branch = `codex/cms-batch-${source}`; let synced = 0; let proofReads = 0; let unavailable = true;
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const pull = { number: 1, state: 'closed', merged_at: '2026-11-16T00:00:00Z', merged: true, merge_commit_sha: merged, head: { ref: branch }, html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/1' };
    const request: typeof fetch = async (input, options) => {
      const route = String(input).replace('https://api.github.com/repos/teddy920810/ai-watermark-remover', '');
      if (route === '/git/ref/heads/codex/cms-blog-editing') return json({ object: { sha: synced ? merged : source } });
      if (route === '/git/ref/heads/main') return json({ object: { sha: merged } });
      if (route.startsWith('/pulls?')) return json(synced ? [] : [pull]);
      if (route === '/pulls/1') return json(pull);
      if (route === '/merges' && options?.method === 'POST') { synced++; return new Response(null, { status: 204 }); }
      if (String(input).endsWith('/cms-build.json')) { proofReads++; if (unavailable) throw new Error('Temporary site failure'); return json({ revision: merged }); }
      if (String(input).endsWith('/blog/example')) return new Response(null, { status: 404 });
      throw new Error(`Unexpected request ${route}`);
    };
    const options = { payload: { action: { name: 'publish-blog-batch' }, repository: { owner: 'teddy920810', repo: 'ai-watermark-remover', ref: 'codex/cms-blog-editing', sha: main } }, token: 'test', actor: 'test-editor', runId: '1', git: (...args: string[]) => args[0] === 'fetch' ? '' : f.git(...args), request, pause: async () => {} };
    await expect(publishBatch(options)).rejects.toThrow('Temporary site failure'); expect(synced).toBe(0);
    unavailable = false; expect((await publishBatch(options)).state).toBe('published'); expect(proofReads).toBe(2); expect(synced).toBe(1);
  });
});
