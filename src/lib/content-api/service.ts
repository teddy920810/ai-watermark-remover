import { createHash, timingSafeEqual } from 'node:crypto';
import YAML from 'yaml';
import blogTemplate from '../../../cms-templates/blog.md?raw';
import landingTemplate from '../../../cms-templates/landing.json?raw';
import { parseCmsDocument } from '../../../scripts/lib/cms-document.mjs';
import { collectPublicationIssues } from '../../../scripts/lib/cms-publication-policy.mjs';
import { projectContent, contentHash, contentImages } from '../../../scripts/lib/content-baseline.mjs';
import type { ContentRepository, ContentSnapshot } from './repository';
import { ContentError, type ContentEntry, type ContentKind, contentPath, entryImages, entryPath, exact, fail, inspectImage, limits, object, parseEntry, publicSchema, safeLink } from './validation';

export interface ContentApiConfig { tokenHashes: string[]; actor: string; publicOrigin: string }
interface Asset { path: string; sha256: string; width: number; height: number; bytes: number; mime: string }
interface Change {
  version: 1; id: string; title: string; actor: string; baseRevision: string; createdAt: string;
  entries: string[]; assets: Asset[]; events: Record<string, { fingerprint: string; result?: Record<string, unknown> }>;
  pull?: number; approval?: { digest: string; actor: string; reference: string; note: string };
}
const baselinePath = 'tests/fixtures/seo-content-baseline.json';
const hash = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const metadataPath = (id: string) => `.content-api/${id}.json`;
const branchName = (id: string) => `codex/content-${id}`;
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function serialize(path: string, entry: ContentEntry) { return path.endsWith('.json') ? json(entry.data) : Buffer.from(`---\n${YAML.stringify(entry.data)}---\n${entry.body}`); }
function readEntry(path: string, bytes: Buffer): ContentEntry { const result = parseCmsDocument(path, bytes.toString('utf8')); return { data: result.data, body: result.body ?? '' }; }
function metadata(snapshot: ContentSnapshot, id: string): Change {
  const source = snapshot.files.get(metadataPath(id)); if (!source) return fail(404, 'NOT_FOUND', 'Change set not found.');
  const change = JSON.parse(source.toString('utf8')) as Change;
  if (change.id !== id || change.version !== 1 || !Array.isArray(change.entries) || !Array.isArray(change.assets)) return fail(409, 'INVALID_CHANGE', 'Change metadata needs maintainer review.');
  return change;
}
function candidate(snapshot: ContentSnapshot, change: Change) {
  const entries = new Map<string, Buffer>();
  for (const path of change.entries) {
    if (!contentPath(path)) fail(409, 'INVALID_CHANGE', 'Change contains an unsupported path.');
    const source = snapshot.files.get(path); if (!source) fail(409, 'INVALID_CHANGE', 'A change entry is missing.');
    const entry = readEntry(path, source); entry.data.draft = false; entries.set(path, serialize(path, entry));
  }
  const digest = hash(JSON.stringify([...entries].map(([path, bytes]) => [path, hash(bytes)]).concat(change.assets.map(a => [a.path, a.sha256])).sort(([a], [b]) => a.localeCompare(b))));
  return { entries, digest };
}
function view(snapshot: ContentSnapshot, change: Change) {
  return { id: change.id, title: change.title, revision: snapshot.revision, baseRevision: change.baseRevision, state: change.approval ? 'approved' : 'draft', digest: candidate(snapshot, change).digest, entries: change.entries, assets: change.assets, pullRequest: change.pull ? `https://github.com/teddy920810/ai-watermark-remover/pull/${change.pull}` : null, approval: change.approval ?? null };
}
function tokenValid(request: Request, config: ContentApiConfig) {
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('authorization') ?? '');
  const value = Buffer.from(hash(match?.[1] ?? ''), 'hex');
  return config.tokenHashes.reduce((valid, expected) => (/^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(value, Buffer.from(expected, 'hex')) && !!match) || valid, false);
}
async function requestJson(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail(415, 'JSON_REQUIRED', 'Use application/json.');
  if (Number(request.headers.get('content-length') ?? 0) > limits.requestBytes) return fail(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limits.requestBytes) { await reader.cancel(); fail(413, 'REQUEST_TOO_LARGE', 'Request is too large.'); } chunks.push(next.value); }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return { data: object(JSON.parse(raw || '{}')), raw }; } catch (error) { if (error instanceof ContentError) throw error; return fail(400, 'INVALID_JSON', 'Request body is not valid JSON.'); }
}

export function createContentApi({ repository, config, fetch: fetcher = globalThis.fetch }: { repository: ContentRepository; config: ContentApiConfig; fetch?: typeof globalThis.fetch }) {
  const reply = (body: unknown, status = 200, revision?: string) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', ...(revision ? { ETag: `"${revision}"` } : {}) } });
  async function load(id: string) {
    try { return await repository.snapshot(branchName(id)); }
    catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      const main = await repository.snapshot('main'); const change = metadata(main, id);
      if (!change.pull) throw error;
      const pull = await repository.getPull(change.pull);
      if (!pull.merged || !pull.mergeRevision) throw error;
      return repository.snapshot(pull.mergeRevision);
    }
  }
  async function validation(snapshot: ContentSnapshot, change: Change) {
    const proposed = candidate(snapshot, change); const files = new Map(snapshot.files); for (const [path, bytes] of proposed.entries) files.set(path, bytes);
    const records = [...files].filter(([path]) => contentPath(path)).map(([path, bytes]) => ({ path, ...readEntry(path, bytes) }));
    const issues = collectPublicationIssues(records, pathname => files.has(`public${pathname}`));
    if (!change.entries.length) issues.push('At least one content entry is required.');
    for (const [path, bytes] of proposed.entries) {
      const entry = readEntry(path, bytes); const refs = entryImages(entry);
      if (path.endsWith('.md') && !(entry.data.contentMode === 'html' ? String(entry.data.bodyHtml ?? '').trim() : entry.body.trim())) issues.push(`${path}: publication requires a nonempty article body.`);
      for (const image of refs.paths) if (!safeLink(image, true) || !files.has(`public${image}`) || image === '/images/image-placeholder.svg') issues.push(`${path}: missing or placeholder image ${image}.`);
      for (const [before, after] of refs.pairs) {
        if (before === after) { issues.push(`${path}: Before and After must be independent files.`); continue; }
        const sizes = await Promise.all([before, after].map(async image => {
          const known = change.assets.find(a => a.path === image); if (known) return known;
          if (!files.has(`public${image}`)) return null;
          const bytes = repository.readAsset ? await repository.readAsset(`public${image}`, snapshot.revision) : files.get(`public${image}`)!;
          const mime = image.endsWith('.png') ? 'image/png' : image.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          try { return await inspectImage(bytes, mime); } catch { return null; }
        }));
        if (!sizes[0] || !sizes[1] || sizes[0].width * sizes[1].height !== sizes[1].width * sizes[0].height) issues.push(`${path}: comparison images must decode with a matching aspect ratio. Editors must separately verify identical composition.`);
      }
    }
    return { publishable: issues.length === 0, issues: [...new Set(issues)], digest: proposed.digest, revision: snapshot.revision };
  }
  async function status(snapshot: ContentSnapshot, change: Change) {
    if (!change.pull) return view(snapshot, change);
    const pull = await repository.getPull(change.pull);
    if (!pull.merged) return { ...view(snapshot, change), state: pull.state === 'closed' ? 'closed' : change.approval ? 'awaiting-ci-or-merge' : 'in-review', checks: await repository.checks(pull.head) };
    let published = false;
    try {
      const response = await fetcher(`${config.publicOrigin}/content-publications.json`, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'Cache-Control': 'no-cache' } });
      if (response.ok) { const result = await response.json(); published = Array.isArray(result.publications) && result.publications.some((p: { id: string; digest: string }) => p.id === change.id && p.digest === change.approval?.digest); }
    } catch { /* A merged PR remains pending until public build evidence is available. */ }
    return { ...view(snapshot, change), state: published ? 'published' : 'merged-awaiting-deployment', mergeRevision: pull.mergeRevision };
  }
  return async (request: Request): Promise<Response> => {
    try {
      if (!config.tokenHashes.length) return reply({ error: { code: 'NOT_CONFIGURED', message: 'Content API is not configured.' } }, 503);
      if (!tokenValid(request, config)) return reply({ error: { code: 'UNAUTHORIZED', message: 'A valid content Bearer token is required.' } }, 401);
      const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/content\/v1\/?/, '').split('/').filter(Boolean);
      if (path.some(p => !/^[a-zA-Z0-9.-]+$/.test(p))) fail(404, 'NOT_FOUND', 'Unknown endpoint.');
      if (request.method === 'GET' && path.join('/') === 'schema') return reply(publicSchema());
      if (request.method === 'GET' && path[0] === 'templates' && path.length === 2) {
        if (!['blog', 'landing'].includes(path[1])) fail(404, 'NOT_FOUND', 'Unknown template.');
        const source = path[1] === 'blog' ? blogTemplate : landingTemplate;
        return reply({ kind: path[1], ...readEntry(path[1] === 'blog' ? 'template.md' : 'template.json', Buffer.from(source)) });
      }
      if (request.method === 'GET' && path[0] === 'entries' && path.length <= 3) {
        const snapshot = await repository.snapshot('main');
        if (path.length === 1) return reply({ revision: snapshot.revision, entries: [...snapshot.files].filter(([p]) => contentPath(p)).map(([p, b]) => ({ path: p, ...readEntry(p, b).data })) }, 200, snapshot.revision);
        if (path.length !== 3) fail(404, 'NOT_FOUND', 'Use /entries/{kind}/{slug}.');
        const file = entryPath(path[1], path[2]); const source = snapshot.files.get(file); if (!source) fail(404, 'NOT_FOUND', 'Entry not found.');
        return reply({ revision: snapshot.revision, path: file, ...readEntry(file, source) }, 200, snapshot.revision);
      }
      if (path[0] !== 'changes' || path.length > 5) fail(404, 'NOT_FOUND', 'Unknown endpoint.');
      const create = path.length === 1 && request.method === 'POST';
      if (!create && !/^[a-f0-9]{24}$/.test(path[1] ?? '')) fail(404, 'NOT_FOUND', 'Unknown change set.');
      if (request.method === 'GET') {
        const snapshot = await load(path[1]); const change = metadata(snapshot, path[1]);
        if (path.length === 2) return reply(await status(snapshot, change), 200, snapshot.revision);
        if (path.length === 4 && path[2] === 'assets') {
          const asset = change.assets.find(a => a.path.split('/').at(-1) === path[3]); if (!asset) fail(404, 'NOT_FOUND', 'Change asset not found.');
          const bytes = repository.readAsset ? await repository.readAsset(`public${asset.path}`, snapshot.revision) : snapshot.files.get(`public${asset.path}`);
          if (!bytes || hash(bytes) !== asset.sha256) fail(409, 'ASSET_CHANGED', 'Asset does not match its recorded digest.');
          return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } });
        }
        if (path.length === 5 && path[2] === 'entries') { const file = entryPath(path[3], path[4]); const bytes = snapshot.files.get(file); if (!bytes) fail(404, 'NOT_FOUND', 'Entry not found.'); return reply({ revision: snapshot.revision, path: file, ...readEntry(file, bytes) }, 200, snapshot.revision); }
        fail(404, 'NOT_FOUND', 'Unknown endpoint.');
      }
      const key = request.headers.get('idempotency-key'); if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail(400, 'IDEMPOTENCY_REQUIRED', 'Provide an 8–128 character Idempotency-Key.');
      const { data, raw } = await requestJson(request); const fingerprint = hash(`${request.method}:${url.pathname}:${raw}`); const eventKey = hash(key);
      const id = create ? hash(`${config.actor}:${key}`).slice(0, 24) : path[1]; const branch = branchName(id);
      let snapshot: ContentSnapshot; let change: Change;
      if (create) {
        exact(data, ['title']); if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 180 || [...data.title].some(char => char.charCodeAt(0) < 32)) fail(422, 'INVALID_TITLE', 'Provide a single-line title, at most 180 characters.');
        try { snapshot = await repository.snapshot(branch); change = metadata(snapshot, id); }
        catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
          const main = await repository.snapshot('main'); await repository.createBranch(branch, main.revision); snapshot = await repository.snapshot(branch);
          change = { version: 1, id, title: data.title, actor: config.actor, baseRevision: main.revision, createdAt: new Date().toISOString(), entries: [], assets: [], events: {} };
        }
      } else { snapshot = await load(id); change = metadata(snapshot, id); }
      const event = change.events[eventKey];
      if (event) { if (event.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different operation or payload.'); if (path[2] === 'review' && change.pull && change.approval) await repository.ready(change.pull); return reply({ ...(create ? view(snapshot, change) : await status(snapshot, change)), ...event.result }, create ? 201 : 200, snapshot.revision); }
      if (!create) {
        if (change.pull) { const pull = await repository.getPull(change.pull); if (pull.merged && request.method === 'POST' && path.length === 3 && path[2] === 'publish') { exact(data, []); return reply(await status(snapshot, change), 202, snapshot.revision); } if (pull.merged || pull.state === 'closed') fail(409, 'CHANGE_CLOSED', 'This review is closed. Start a new change set.'); }
        const expected = request.headers.get('if-match'); if (!expected) fail(428, 'REVISION_REQUIRED', 'Provide the quoted revision in If-Match.');
        if (expected !== `"${snapshot.revision}"`) fail(409, 'REVISION_CONFLICT', 'Change set has advanced. Read it before retrying.');
      }
      const updates = new Map<string, Buffer>(); let result: Record<string, unknown> = {};
      if (create) { /* Persist metadata below. */ }
      else if (request.method === 'PUT' && path.length === 5 && path[2] === 'entries') {
        const file = entryPath(path[3], path[4]);
        const duplicates = [...snapshot.files].filter(([p]) => contentPath(p) && p !== file && p.startsWith(file.slice(0, file.lastIndexOf('/') + 1))).some(([p, b]) => readEntry(p, b).data.slug === path[4]);
        if (duplicates) fail(409, 'SLUG_EXISTS', 'This slug already belongs to another file.');
        const old = snapshot.files.get(file); const entry = parseEntry(path[3] as ContentKind, data, path[4], old ? readEntry(file, old) : undefined);
        updates.set(file, serialize(file, entry)); if (!change.entries.includes(file)) change.entries.push(file); delete change.approval;
        if (change.entries.length > limits.entriesPerChange) fail(422, 'CHANGE_LIMIT', 'At most 20 entries per change set.');
      } else if (request.method === 'POST' && path.length === 3 && path[2] === 'assets') {
        exact(data, ['name', 'mime', 'base64']); if (typeof data.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|jpeg|png|webp)$/.test(data.name) || data.name.length > 100) fail(422, 'ASSET_NAME', 'Use a lowercase ASCII image filename, at most 100 characters.');
        if (typeof data.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) fail(422, 'ASSET_ENCODING', 'Use canonical base64.');
        const bytes = Buffer.from(data.base64, 'base64'); const image = await inspectImage(bytes, String(data.mime));
        if (!data.name.endsWith(`.${image.extension}`) && !(image.extension === 'jpg' && data.name.endsWith('.jpeg'))) fail(415, 'ASSET_TYPE', 'Filename extension must match the image bytes.');
        const digest = hash(bytes); const imagePath = `/uploads/content-api/${id}/${data.name.replace(/\.[^.]+$/, '')}-${digest.slice(0, 16)}.${image.extension}`;
        if (!change.assets.some(a => a.path === imagePath)) change.assets.push({ path: imagePath, sha256: digest, width: image.width, height: image.height, bytes: image.bytes, mime: image.mime });
        if (change.assets.length > limits.assetsPerChange) fail(422, 'CHANGE_LIMIT', 'At most 30 assets per change set.');
        updates.set(`public${imagePath}`, bytes); delete change.approval; result = { asset: change.assets.find(a => a.path === imagePath) };
      } else if (request.method === 'POST' && path.length === 3 && path[2] === 'validate') {
        exact(data, []); return reply(await validation(snapshot, change), 200, snapshot.revision);
      } else if (request.method === 'POST' && path.length === 3 && path[2] === 'review') {
        exact(data, ['digest', 'approval']); const proposed = candidate(snapshot, change);
        if (data.digest !== proposed.digest) fail(409, 'REVIEW_DIGEST_CONFLICT', 'Read and approve the current exact content digest.');
        if (typeof data.approval !== 'string' || data.approval.trim().length < 20 || data.approval.length > 2000) fail(422, 'APPROVAL_REQUIRED', 'Record the content-owner approval of the exact diff (20–2000 characters).');
        const checked = await validation(snapshot, change); if (!checked.publishable) throw new ContentError(422, 'NOT_PUBLISHABLE', 'Complete the content and asset requirements before review.', checked.issues);
        const pull = await repository.openPull(branch, change.title); change.pull = pull.number;
        const reference = await repository.comment(pull.number, `Content-owner authorization\n\nActor: ${config.actor}\nDigest: ${proposed.digest}\nSource revision: ${snapshot.revision}\n\n${data.approval}\n\nFiles:\n${[...proposed.entries].map(([p, b]) => `- ${p}: ${hash(b)}`).join('\n')}\n\nAssets:\n${change.assets.map(a => `- ${a.path}: ${a.sha256}`).join('\n')}`);
        change.approval = { digest: proposed.digest, actor: config.actor, reference, note: data.approval };
        for (const [file, bytes] of proposed.entries) updates.set(file, bytes);
        const baselineBytes = snapshot.files.get(baselinePath);
        if (baselineBytes) {
          const baseline = JSON.parse(baselineBytes.toString('utf8')); let changed = false;
          for (const record of baseline.files) { const source = proposed.entries.get(record.file); if (!source) continue; const projected = projectContent(record.file, source.toString('utf8')); Object.assign(record, { semanticSha256: contentHash(projected), images: contentImages(projected), contentOwnerApproval: reference }); changed = true; }
          if (changed) updates.set(baselinePath, json(baseline));
        }
      } else if (request.method === 'POST' && path.length === 3 && path[2] === 'publish') {
        exact(data, []); if (!change.pull || !change.approval || change.approval.digest !== candidate(snapshot, change).digest) fail(409, 'APPROVAL_REQUIRED', 'This exact content change has not been approved.');
        if (!await repository.verifyApproval(change.pull, change.approval.reference, change.approval.digest)) fail(409, 'APPROVAL_REQUIRED', 'The exact content approval audit is missing.');
        const checked = await validation(snapshot, change); if (!checked.publishable) throw new ContentError(422, 'NOT_PUBLISHABLE', 'Content changed after review.', checked.issues);
        for (const asset of change.assets) {
          if (!asset.path.startsWith(`/uploads/content-api/${id}/`)) fail(409, 'SCOPE_VIOLATION', 'Asset is outside this change set.');
          const bytes = repository.readAsset ? await repository.readAsset(`public${asset.path}`, snapshot.revision) : snapshot.files.get(`public${asset.path}`);
          if (!bytes || hash(bytes) !== asset.sha256) fail(409, 'ASSET_CHANGED', 'An asset changed after content-owner approval.');
        }
        const base = await repository.snapshot(change.baseRevision); const baseBytes = base.files.get(baselinePath);
        if (baseBytes) {
          const expected = JSON.parse(baseBytes.toString('utf8'));
          for (const record of expected.files) { const source = candidate(snapshot, change).entries.get(record.file); if (!source) continue; const projected = projectContent(record.file, source.toString('utf8')); Object.assign(record, { semanticSha256: contentHash(projected), images: contentImages(projected), contentOwnerApproval: change.approval.reference }); }
          if (JSON.stringify(expected) !== JSON.stringify(JSON.parse(snapshot.files.get(baselinePath)?.toString('utf8') ?? 'null'))) fail(409, 'BASELINE_SCOPE_VIOLATION', 'Content baseline contains unapproved differences.');
        }
        const pull = await repository.getPull(change.pull); if (pull.head !== snapshot.revision) fail(409, 'REVISION_CONFLICT', 'Pull request head differs from the reviewed change.');
        const allowed = new Set([...change.entries, ...change.assets.map(a => `public${a.path}`), metadataPath(id), baselinePath]);
        if ((await repository.changedFiles(change.pull)).some(file => !allowed.has(file))) fail(409, 'SCOPE_VIOLATION', 'Pull request contains paths outside this content change.');
        const checks = await repository.checks(snapshot.revision);
        if (!['verify', 'Required target artifacts'].every(name => checks.some(c => c.name === name && c.success && c.appId === 15368))) fail(409, 'CI_PENDING_OR_FAILED', 'Required trusted GitHub Actions checks must pass for the exact head.');
        await repository.merge(change.pull, snapshot.revision); return reply(await status(snapshot, change), 202, snapshot.revision);
      } else fail(404, 'NOT_FOUND', 'Unknown endpoint.');
      if (Object.keys(change.events).length >= 200) fail(422, 'CHANGE_LIMIT', 'Start a new change set after 200 mutations.');
      change.events[eventKey] = { fingerprint, result }; updates.set(metadataPath(id), json(change));
      const revision = await repository.commit(branch, snapshot.revision, updates);
      for (const [file, bytes] of updates) snapshot.files.set(file, bytes); snapshot.revision = revision;
      if (change.approval && change.pull) await repository.ready(change.pull);
      return reply({ ...view(snapshot, change), ...result }, create ? 201 : 200, revision);
    } catch (error) {
      if (error instanceof ContentError) return reply({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status);
      const status = (error as { status?: number }).status;
      return reply({ error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'REVISION_CONFLICT' : 'REPOSITORY_UNAVAILABLE', message: status === 404 ? 'Content or change set not found.' : status === 409 ? 'Read the current revision before retrying.' : 'The content repository is unavailable. Retry with the same idempotency key.' } }, status === 404 ? 404 : status === 409 ? 409 : 503);
    }
  };
}
