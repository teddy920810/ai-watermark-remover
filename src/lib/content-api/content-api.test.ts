import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { projectContent, contentHash } from '../../../scripts/lib/content-baseline.mjs';
import { createContentApi } from './service';
import type { ContentRepository, ContentSnapshot, PullRequest } from './repository';

const secret = 'unit-test-content-token-with-at-least-32-characters';
const config = { tokenHashes: [createHash('sha256').update(secret).digest('hex')], actor: 'seo-editor', publicOrigin: 'https://www.watermarkgemini.com' };
class MemoryRepository implements ContentRepository {
  refs = new Map<string, ContentSnapshot>([['main', { revision: '1'.repeat(40), files: new Map() }]]);
  commits = 0;
  pull: PullRequest | null = null;
  comments: string[] = [];
  async snapshot(ref: string) { const found = this.refs.get(ref) ?? [...this.refs.values()].find(s => s.revision === ref); if (!found) throw Object.assign(new Error('missing'), { status: 404 }); return { revision: found.revision, files: new Map(found.files) }; }
  async createBranch(branch: string, revision: string) { if (this.refs.has(branch)) return; const found = [...this.refs.values()].find(s => s.revision === revision)!; this.refs.set(branch, { revision, files: new Map(found.files) }); }
  async commit(branch: string, revision: string, updates: Map<string, Buffer>) { const state = await this.snapshot(branch); if (state.revision !== revision) throw Object.assign(new Error('conflict'), { status: 409 }); for (const [path, value] of updates) state.files.set(path, value); state.revision = String(++this.commits + 1).padStart(40, '0'); this.refs.set(branch, state); return state.revision; }
  async openPull(branch: string) { return this.pull ??= { number: 101, url: 'https://github.com/teddy920810/ai-watermark-remover/pull/101', branch, state: 'open', merged: false, head: this.refs.get(branch)!.revision }; }
  async getPull() { return { ...this.pull!, head: this.refs.get(this.pull!.branch!)?.revision ?? this.pull!.head }; }
  async comment(_number: number, body: string) { this.comments.push(body); return 'https://github.com/teddy920810/ai-watermark-remover/pull/101#issuecomment-123'; }
  async ready() {}
  async verifyApproval(_number: number, _reference: string, digest: string) { return this.comments.some(c => c.includes(`Digest: ${digest}\n`)); }
  async merge(_number: number, head: string) { this.pull = { ...this.pull!, merged: true, state: 'closed', head, mergeRevision: 'f'.repeat(40) }; return 'f'.repeat(40); }
  async checks() { return [{ name: 'verify', success: true, appId: 15368 }, { name: 'Required target artifacts', success: true, appId: 15368 }]; }
  async changedFiles() { return [...(await this.snapshot(this.pull!.branch!)).files.keys()]; }
}
function harness() {
  const repository = new MemoryRepository();
  const handle = createContentApi({ repository, config, fetch: async () => new Response('{"publications":[]}') });
  async function call(path: string, method = 'GET', data?: unknown, revision?: string, key = 'request-12345678', token: string | null = secret) {
    return handle(new Request(`https://www.watermarkgemini.com/api/content/v1${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}), ...(revision ? { 'If-Match': `"${revision}"` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }));
  }
  return { repository, call };
}
describe('content-only Agent API', () => {
  it('rejects absent and wrong tokens before consulting durable content; fails closed without configuration', async () => {
    const { call, repository } = harness();
    expect((await call('/schema', 'GET', undefined, undefined, undefined, null)).status).toBe(401);
    expect((await call('/schema', 'GET', undefined, undefined, undefined, 'wrong')).status).toBe(401);
    expect(repository.commits).toBe(0);
    expect((await createContentApi({ repository, config: { ...config, tokenHashes: [] } })(new Request('https://www.watermarkgemini.com/api/content/v1/schema'))).status).toBe(503);
  });
  it('exposes one schema and real templates, creates durable drafts and replays idempotently', async () => {
    const { call, repository } = harness();
    const schema = await (await call('/schema')).json(); expect(schema.kinds).toEqual(['landing', 'blog']);
    const template = await (await call('/templates/blog')).json(); expect(template.data.draft).toBe(true);
    const response = await call('/changes', 'POST', { title: 'Isolated acceptance draft' }); expect(response.status).toBe(201);
    const change = await response.json();
    const replay = await call('/changes', 'POST', { title: 'Isolated acceptance draft' }); expect(await replay.json()).toEqual(change);
    expect((await call('/changes', 'POST', { title: 'Different payload' })).status).toBe(409);
    const saved = await call(`/changes/${change.id}/entries/blog/acceptance-only`, 'PUT', { data: { ...template.data, slug: 'acceptance-only', title: 'Isolated acceptance draft' }, body: '## Draft\n\nUnpublished acceptance content.' }, change.revision, 'save-12345678');
    expect(saved.status).toBe(200); const next = await saved.json();
    expect((await repository.snapshot(`codex/content-${change.id}`)).files.has('src/content/blog/acceptance-only.md')).toBe(true);
    expect((await repository.snapshot('main')).files.size).toBe(0);
    expect((await call(`/changes/${change.id}/entries/blog/acceptance-only`, 'PUT', { data: template.data, body: 'changed' }, change.revision, 'save-87654321')).status).toBe(409);
    const freshHandle = createContentApi({ repository, config });
    const durable = await freshHandle(new Request(`https://www.watermarkgemini.com/api/content/v1/changes/${change.id}`, { headers: { Authorization: `Bearer ${secret}` } }));
    expect((await durable.json()).revision).toBe(next.revision);
  });
  it('rejects active content, unknown fields, traversal, private image references and mutation without a version', async () => {
    const { call } = harness(); const change = await (await call('/changes', 'POST', { title: 'Safety checks' })).json();
    const template = await (await call('/templates/blog')).json();
    for (const body of ['<script>alert(1)</script>', '[bad](javascript:alert)', 'import Component from "x";', '<img src=x onerror=alert(1)>']) {
      expect((await call(`/changes/${change.id}/entries/blog/safety-check`, 'PUT', { data: { ...template.data, slug: 'safety-check' }, body }, change.revision, `unsafe-${createHash('sha256').update(body).digest('hex')}`)).status).toBe(422);
    }
    expect((await call(`/changes/${change.id}/entries/blog/safety-check`, 'PUT', { data: { ...template.data, slug: 'safety-check', provider: 'live' }, body: 'Safe' }, change.revision, 'unknown-12345678')).status).toBe(422);
    expect((await call(`/changes/${change.id}/entries/blog/safety-check`, 'PUT', { data: { ...template.data, slug: 'safety-check', coverImage: '/api/v1/download/private' }, body: 'Safe' }, change.revision, 'private-12345678')).status).toBe(422);
    expect((await call(`/changes/${change.id}/entries/blog/safety-check`, 'PUT', { data: template.data, body: 'Safe' }, undefined, 'version-12345678')).status).toBe(428);
    expect((await call('/provider', 'POST', {})).status).toBe(404);
    expect((await call('/changes', 'POST', { title: 'Safety checks', path: '../src/lib/services.ts' })).status).toBe(422);
  });
  it('blocks publication placeholders and makes approval bind to an exact review digest', async () => {
    const { call } = harness(); const change = await (await call('/changes', 'POST', { title: 'Review checks' })).json();
    const template = await (await call('/templates/blog')).json();
    const saved = await (await call(`/changes/${change.id}/entries/blog/review-check`, 'PUT', { data: { ...template.data, slug: 'review-check' }, body: 'Draft text' }, change.revision, 'save-12345678')).json();
    const validation = await (await call(`/changes/${change.id}/validate`, 'POST', {}, saved.revision, 'validate-12345678')).json();
    expect(validation.publishable).toBe(false); expect(validation.issues.length).toBeGreaterThan(0);
    expect((await call(`/changes/${change.id}/review`, 'POST', { digest: 'wrong', approval: 'I approve this exact content difference.' }, saved.revision, 'review-12345678')).status).toBe(409);
    expect((await call(`/changes/${change.id}/publish`, 'POST', {}, saved.revision, 'publish-12345678')).status).toBe(409);
  });
  it('uploads original bytes, binds exact content approval, and requires trusted checks before protected merge', async () => {
    const { call, repository } = harness();
    let change = await (await call('/changes', 'POST', { title: 'Unpublished end-to-end fixture' })).json();
    const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3388aa' } }).png().toBuffer();
    const upload = { name: 'acceptance-image.png', mime: 'image/png', base64: bytes.toString('base64') };
    const first = await call(`/changes/${change.id}/assets`, 'POST', upload, change.revision, 'asset-12345678');
    expect(first.status).toBe(200); const assetResponse = await first.json();
    const replay = await (await call(`/changes/${change.id}/assets`, 'POST', upload, change.revision, 'asset-12345678')).json();
    expect(replay.asset).toEqual(assetResponse.asset);
    change = assetResponse;
    const template = await (await call('/templates/blog')).json();
    const saved = await call(`/changes/${change.id}/entries/blog/isolated-review`, 'PUT', { data: { ...template.data, slug: 'isolated-review', title: 'Isolated fixture', description: 'A valid unpublished fixture for the protected review flow.', coverImage: change.asset.path, coverAlt: 'A blue rectangle used only by the isolated fixture' }, body: '## Fixture\n\nThis is an unpublished integration fixture.' }, change.revision, 'entry-12345678');
    expect(saved.status).toBe(200); change = await saved.json();
    expect(repository.refs.get(`codex/content-${change.id}`)!.files.get(`public${assetResponse.asset.path}`)).toEqual(bytes);
    expect((await (await call(`/changes/${change.id}/validate`, 'POST', {}, change.revision, 'validate-87654321')).json()).publishable).toBe(true);
    const review = await call(`/changes/${change.id}/review`, 'POST', { digest: change.digest, approval: 'The content owner approves these exact isolated fixture differences.' }, change.revision, 'review-87654321');
    expect(review.status).toBe(200); change = await review.json();
    expect(repository.comments[0]).toContain(change.digest); expect(change.approval.reference).toContain('#issuecomment-');
    repository.checks = async () => [{ name: 'verify', success: true, appId: 999 }];
    expect((await call(`/changes/${change.id}/publish`, 'POST', {}, change.revision, 'publish-87654321')).status).toBe(409);
    repository.checks = async () => [{ name: 'verify', success: true, appId: 15368 }, { name: 'Required target artifacts', success: true, appId: 15368 }];
    const published = await call(`/changes/${change.id}/publish`, 'POST', {}, change.revision, 'publish-87654321');
    expect(published.status).toBe(202); expect((await published.json()).state).toBe('merged-awaiting-deployment');
    expect(repository.refs.get('main')!.files.size).toBe(0); // Memory transport never claims a real GitHub merge.
  });
  it('rejects disguised, oversized and broken assets while preserving the branch revision', async () => {
    const { call, repository } = harness(); const change = await (await call('/changes', 'POST', { title: 'Asset rejection fixture' })).json();
    for (const payload of [{ name: 'script.png', mime: 'image/png', base64: Buffer.from('<script>bad</script>').toString('base64') }, { name: 'broken.png', mime: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }, { name: 'remote.svg', mime: 'image/svg+xml', base64: 'AAAA' }]) {
      expect((await call(`/changes/${change.id}/assets`, 'POST', payload, change.revision, `reject-${payload.name.replace('.', '-')}`)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await repository.snapshot(`codex/content-${change.id}`)).revision).toBe(change.revision);
  });
  it('updates only explicitly approved protected baselines and refuses unrelated baseline tampering at publish', async () => {
    const { call, repository } = harness();
    const document = JSON.parse(readFileSync('docs/examples/content-api/blog.json', 'utf8'));
    document.data.slug = 'protected-post'; document.data.draft = false;
    document.body = '## Protected article\n\nAn existing article in the isolated test repository.';
    const file = 'src/content/blog/protected-post.md';
    const source = Buffer.from(`---\n${YAML.stringify(document.data)}---\n${document.body}`);
    const baselinePath = 'tests/fixtures/seo-content-baseline.json';
    const baseline = { files: [{ file, semanticSha256: contentHash(projectContent(file, source.toString())), images: [] }, { file: 'src/content/blog/unrelated.md', semanticSha256: 'unchanged', images: [] }] };
    const main = repository.refs.get('main')!;
    main.files.set(file, source); main.files.set('public/uploads/background-remover-product-photo.png', Buffer.from('existing asset'));
    main.files.set(baselinePath, Buffer.from(JSON.stringify(baseline)));
    let change = await (await call('/changes', 'POST', { title: 'Explicit protected content update' })).json();
    document.data.description = 'This exact description update is explicitly authorized in the review below.';
    change = await (await call(`/changes/${change.id}/entries/blog/protected-post`, 'PUT', document, change.revision, 'save-protected-123')).json();
    expect((await repository.snapshot(`codex/content-${change.id}`)).files.get(baselinePath)).toEqual(main.files.get(baselinePath));
    change = await (await call(`/changes/${change.id}/review`, 'POST', { digest: change.digest, approval: 'The content owner approves only this protected description difference.' }, change.revision, 'review-protected-123')).json();
    const state = await repository.snapshot(`codex/content-${change.id}`);
    const updated = JSON.parse(state.files.get(baselinePath)!.toString());
    expect(updated.files[0].contentOwnerApproval).toContain('#issuecomment-');
    expect(updated.files[1]).toEqual(baseline.files[1]);
    updated.files[1].semanticSha256 = 'tampered';
    const revision = await repository.commit(`codex/content-${change.id}`, state.revision, new Map([[baselinePath, Buffer.from(JSON.stringify(updated))]]));
    const refused = await call(`/changes/${change.id}/publish`, 'POST', {}, revision, 'publish-protected-123');
    expect(refused.status).toBe(409); expect((await refused.json()).error.code).toBe('BASELINE_SCOPE_VIOLATION');
    expect(repository.pull!.merged).toBe(false);
  });
});
