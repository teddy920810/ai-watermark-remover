// Run from the project root. Creates a durable draft only; review/publish stay explicit.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function createDraftExample({ documentFile, tokenFile, output, imageFile, beforeFile, afterFile, alignedPair = false, origin = 'https://www.watermarkgemini.com', fetcher = globalThis.fetch }) {
  const target = new URL(origin);
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('Use a plain HTTPS origin.');
  const source = await readFile(documentFile, 'utf8'); const document = JSON.parse(source);
  if (document.data?.draft !== true) throw new Error('This example accepts unpublished drafts only.');
  const kind = Object.hasOwn(document.data, 'process') ? 'landing' : 'blog';
  if (!!beforeFile !== !!afterFile || beforeFile && (!alignedPair || kind !== 'landing')) throw new Error('A landing pair requires both real files and --aligned-pair-confirmed after visual review.');
  const inputs = [];
  for (const [role, filename] of [['image', imageFile], ['before', beforeFile], ['after', afterFile]]) {
    if (!filename) continue;
    const bytes = await readFile(filename);
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime || !bytes.length || bytes.length > 2_000_000) throw new Error('Use original single-frame PNG/JPEG/WebP files within 2,000,000 bytes; the API also decodes dimensions.');
    inputs.push({ role, bytes, sha256: hash(bytes), mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.slice(6) });
  }
  if (beforeFile && inputs.find(item => item.role === 'before').sha256 === inputs.find(item => item.role === 'after').sha256) throw new Error('Before and After must be independent source files.');
  const inputSha = hash(JSON.stringify({ source, origin: target.origin, inputs: inputs.map(({ role, sha256 }) => ({ role, sha256 })) }));
  const file = resolve(output); await mkdir(dirname(file), { recursive: true });
  let journal;
  try { journal = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Preserve the invalid recovery record for review.', { cause: error }); }
  journal ??= { version: 1, inputSha, run: randomUUID(), requests: {}, responses: {} };
  if (journal.version !== 1 || journal.inputSha !== inputSha) throw new Error('Input or origin changed; preserve this record and select a new output.');
  const save = async () => { await writeFile(file + '.tmp', JSON.stringify(journal, null, 2), { mode: 0o600 }); await rename(file + '.tmp', file); };
  await save();
  const token = (await readFile(tokenFile, 'utf8')).trim();
  async function api(step, path, method, data, revision) {
    const key = `${journal.run}-${step}`; const fingerprint = hash(JSON.stringify({ path, method, data }));
    const previous = journal.requests[key];
    if (previous && previous.fingerprint !== fingerprint) throw new Error('This operation key belongs to a different request.');
    if (journal.responses[key]) return journal.responses[key];
    if (previous) revision = previous.revision;
    else journal.requests[key] = { fingerprint, revision };
    await save();
    const response = await fetcher(`${target.origin}/api/content/v1${path}`, { method, redirect: 'error', signal: globalThis.AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(revision ? { 'If-Match': `"${revision}"` } : {}) }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(`Content API HTTP ${response.status}: ${result.error?.code ?? 'UNKNOWN'}. Resume with the same output.`);
    journal.responses[key] = result; await save(); return result;
  }
  let change = await api('create', '/changes', 'POST', { title: 'Unpublished operator example' });
  const assets = {};
  for (const input of inputs) {
    change = await api(`asset-${input.role}`, `/changes/${change.id}/assets`, 'POST', { name: `editorial-${input.role}.${input.extension}`, mime: input.mime, base64: input.bytes.toString('base64') }, change.revision);
    assets[input.role] = change.asset;
    if (change.asset.sha256 !== input.sha256) throw new Error('Uploaded bytes differ from the source.');
  }
  const illustration = assets.image ?? assets.before;
  const prepared = illustration ? JSON.parse(JSON.stringify(document).replaceAll('/uploads/background-remover-product-photo.png', illustration.path)) : document;
  if (assets.before && assets.after) {
    if (assets.before.width * assets.after.height !== assets.after.width * assets.before.height) throw new Error('Comparison aspect ratios differ. Preserve the draft and select a reviewed pair in a new recovery record.');
    for (const module of [prepared.data.heroSamples[0], prepared.data.features.items[0], prepared.data.process.steps[1]]) Object.assign(module, { image: assets.before.path, afterImage: assets.after.path });
  }
  change = await api('entry', `/changes/${change.id}/entries/${kind}/${prepared.data.slug}`, 'PUT', prepared, change.revision);
  const validation = await api('validate', `/changes/${change.id}/validate`, 'POST', {}, change.revision);
  journal.last = { change, validation, assets, document: prepared }; await save();
  return { id: change.id, revision: change.revision, draft: true, publishable: validation.publishable, issues: validation.issues, recoveryFile: file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const result = await createDraftExample({ documentFile: option('--document') ?? 'docs/examples/content-api/landing.json', tokenFile: option('--token-file') ?? '.secrets/content-api-token.txt', output: option('--out') ?? 'output/operator-draft.json', imageFile: option('--image'), beforeFile: option('--before'), afterFile: option('--after'), alignedPair: args.includes('--aligned-pair-confirmed'), origin: option('--origin') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
