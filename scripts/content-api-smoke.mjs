import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';

/** Durable, unpublished acceptance only. The recovery record contains no token, signed URL or image bytes. */
export async function runContentApiSmoke({ origin: inputOrigin = 'https://www.watermarkgemini.com', token, output, imageFile, writeDraft = false, fetcher = globalThis.fetch }) {
  const origin = new URL(inputOrigin);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Use an HTTPS origin or a local development origin.');
  if (writeDraft && !imageFile) throw new Error('--write-draft requires --image with an authorized JPEG, PNG or WebP.');
  const bytes = writeDraft ? await readFile(imageFile) : null;
  const png = bytes?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = bytes?.toString('ascii', 0, 4) === 'RIFF';
  const image = bytes ? { sha256: createHash('sha256').update(bytes).digest('hex'), extension: png ? 'png' : webp ? 'webp' : 'jpg', mime: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg' } : null;
  const filename = output ? resolve(output) : writeDraft ? resolve('output/content-api-draft-smoke.json') : null;
  let state;
  if (filename) {
    await mkdir(dirname(filename), { recursive: true }); // Fail before even the first remote request if output cannot be prepared.
    try { const source = await readFile(filename, 'utf8'); try { state = JSON.parse(source); } catch { throw new Error('Recovery record is invalid; preserve it for maintainer review.'); } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const initial = () => ({ version: 1, origin: origin.origin, mode: writeDraft ? 'draft' : 'read', image, runId: randomUUID(), checks: [], change: null, asset: null, entrySaved: false, pending: null, complete: false });
  if (!state) {
    state = initial();
    if (filename) {
      try { await writeFile(filename, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; try { state = JSON.parse(await readFile(filename, 'utf8')); } catch { throw new Error('Recovery record is invalid; preserve it for maintainer review.'); } }
    }
  }
  if (state.version !== 1 || state.origin !== origin.origin || state.mode !== (writeDraft ? 'draft' : 'read') || JSON.stringify(state.image) !== JSON.stringify(image) || typeof state.runId !== 'string') throw new Error('Recovery record belongs to a different origin or input. Use a new output record.');
  async function checkpoint() {
    if (!filename) return;
    const temporary = filename + '.tmp';
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, filename);
  }
  state.complete = false;
  await checkpoint(); // Verify an existing recovery record is writable before any remote mutation.
  async function call(path, method = 'GET', data, revision, key) {
    const response = await fetcher(`${origin.origin}/api/content/v1${path}`, { method, redirect: 'error', signal: globalThis.AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }), ...(revision ? { 'If-Match': `"${revision}"` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await response.json(); state.checks.push({ path, status: response.status });
    if (!response.ok) { await checkpoint(); throw new Error(`Content API ${path}: HTTP ${response.status}; ${result.error?.code ?? 'unknown error'}. Resume with the same output record.`); }
    return result;
  }
  const storeChange = change => ({ id: change.id, revision: change.revision, state: change.state, branch: `codex/content-${change.id}` });
  async function mutate(step, path, payload) {
    const revision = state.pending?.step === step ? state.pending.revision : state.change?.revision;
    const key = `${state.runId}-${step}`;
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (state.pending && (state.pending.step !== step || state.pending.digest !== digest)) throw new Error('Pending request differs from this input; preserve the record for review.');
    state.pending = { step, key, revision, digest }; await checkpoint();
    // A lost response leaves pending + the original key/revision durable; rerunning replays this request.
    const result = await call(path, 'POST', payload, revision, key);
    state.change = storeChange(result); state.pending = null;
    return result;
  }
  await call('/schema'); const template = await call('/templates/blog'); await call('/templates/landing'); await call('/entries');
  if (writeDraft) {
    if (!state.change) { await mutate('create', '/changes', { title: 'Isolated unpublished content API acceptance' }); await checkpoint(); }
    if (!state.asset) {
      const result = await mutate('asset', `/changes/${state.change.id}/assets`, { name: `acceptance.${image.extension}`, mime: image.mime, base64: bytes.toString('base64') });
      const asset = result.asset;
      state.asset = { path: asset.path, sha256: asset.sha256, width: asset.width, height: asset.height, bytes: asset.bytes, mime: asset.mime }; await checkpoint();
    }
    if (!state.entrySaved) {
      const slug = `api-acceptance-${state.runId.slice(-12)}`;
      state.entryPayload ??= { data: { ...template.data, slug, title: 'Isolated unpublished acceptance draft', description: 'This isolated draft verifies durable content and asset references and is not for publication.', coverImage: state.asset.path, coverAlt: 'Authorized image retained in the isolated unpublished acceptance draft', draft: true }, body: '## Isolated acceptance\n\nThis unpublished draft must not be submitted for editorial publication.' };
      const revision = state.pending?.step === 'entry' ? state.pending.revision : state.change.revision;
      const digest = createHash('sha256').update(JSON.stringify(state.entryPayload)).digest('hex');
      if (state.pending && (state.pending.step !== 'entry' || state.pending.digest !== digest)) throw new Error('Pending request differs from this input; preserve the record for review.');
      state.pending = { step: 'entry', key: `${state.runId}-entry`, revision, digest }; await checkpoint();
      const result = await call(`/changes/${state.change.id}/entries/blog/${slug}`, 'PUT', state.entryPayload, revision, state.pending.key);
      state.change = storeChange(result); state.pending = null; state.entrySaved = true; await checkpoint();
    }
    const stored = await call(`/changes/${state.change.id}`);
    if (stored.revision !== state.change.revision || stored.state !== 'draft') throw new Error('Durable draft differs; preserve the recovery record for review.');
    const response = await fetcher(`${origin.origin}/api/content/v1/changes/${state.change.id}/assets/${state.asset.path.split('/').at(-1)}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: globalThis.AbortSignal.timeout(60_000) });
    const received = Buffer.from(await response.arrayBuffer());
    if (!response.ok || createHash('sha256').update(received).digest('hex') !== state.asset.sha256) throw new Error('Durable asset bytes differ; preserve the recovery record for review.');
    state.checks.push({ path: 'asset-bytes', status: response.status, sha256: state.asset.sha256 });
  }
  state.complete = true; await checkpoint();
  return { origin: state.origin, checks: state.checks, change: state.change, asset: state.asset?.path ?? null, recoveryFile: filename };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const token = (await readFile(option('--token-file') ?? '.secrets/content-api-token.txt', 'utf8')).trim();
  const result = await runContentApiSmoke({ origin: option('--origin'), token, output: option('--out'), imageFile: option('--image'), writeDraft: args.includes('--write-draft') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
