import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const origin = new URL(option('--origin') ?? 'https://www.watermarkgemini.com');
if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Use an HTTPS origin or a local development origin.');
const token = (await readFile(option('--token-file') ?? '.secrets/content-api-token.txt', 'utf8')).trim();
const prefix = `acceptance-${randomUUID()}`;
const evidence = { origin: origin.origin, checks: [], change: null };
async function call(path, method = 'GET', data, revision, key = prefix + '-' + evidence.checks.length) {
  const response = await globalThis.fetch(`${origin.origin}/api/content/v1${path}`, { method, redirect: 'error', signal: globalThis.AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }), ...(revision ? { 'If-Match': `"${revision}"` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json(); evidence.checks.push({ path, status: response.status });
  if (!response.ok) throw new Error(`Content API ${path}: HTTP ${response.status}; ${result.error?.code ?? 'unknown error'}`);
  return result;
}
await call('/schema'); await call('/templates/blog'); await call('/templates/landing'); await call('/entries');
if (args.includes('--write-draft')) {
  const imageFile = option('--image'); if (!imageFile) throw new Error('--write-draft requires --image with an authorized JPEG, PNG or WebP.');
  const bytes = await readFile(imageFile); const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])); const webp = bytes.toString('ascii', 0, 4) === 'RIFF';
  const extension = png ? 'png' : webp ? 'webp' : 'jpg'; const mime = png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg';
  let change = await call('/changes', 'POST', { title: 'Isolated unpublished content API acceptance' });
  change = await call(`/changes/${change.id}/assets`, 'POST', { name: `acceptance.${extension}`, mime, base64: bytes.toString('base64') }, change.revision, prefix + '-asset');
  const asset = change.asset; const template = await call('/templates/blog');
  const slug = `api-acceptance-${prefix.slice(-12)}`;
  change = await call(`/changes/${change.id}/entries/blog/${slug}`, 'PUT', { data: { ...template.data, slug, title: 'Isolated unpublished acceptance draft', description: 'This isolated draft verifies durable content and asset references and is not for publication.', coverImage: asset.path, coverAlt: 'Authorized image retained in the isolated unpublished acceptance draft', draft: true }, body: '## Isolated acceptance\n\nThis unpublished draft must not be submitted for editorial publication.' }, change.revision);
  const stored = await call(`/changes/${change.id}`);
  if (stored.revision !== change.revision || stored.state !== 'draft') throw new Error('Durable draft state differs.');
  const response = await globalThis.fetch(`${origin.origin}/api/content/v1/changes/${change.id}/assets/${asset.path.split('/').at(-1)}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
  const received = Buffer.from(await response.arrayBuffer());
  if (!response.ok || createHash('sha256').update(received).digest('hex') !== asset.sha256) throw new Error('Durable asset bytes differ.');
  evidence.checks.push({ path: 'asset-bytes', status: response.status, sha256: asset.sha256 });
  evidence.change = { id: change.id, revision: change.revision, branch: `codex/content-${change.id}`, state: 'draft', asset: asset.path };
}
const output = option('--out'); if (output) await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
