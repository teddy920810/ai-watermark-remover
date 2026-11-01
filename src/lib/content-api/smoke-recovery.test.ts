import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/content-api-smoke.mjs');
const roots: string[] = []; const servers: Server[] = [];
const token = 'isolated-smoke-token-never-a-production-secret';
const imageBytes = Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  const allowed = resolve('output') + sep;
  for (const root of roots.splice(0)) { if (!resolve(root).startsWith(allowed)) throw new Error('Unsafe fixture cleanup path'); await rm(root, { recursive: true, force: true }); }
});
async function fixture() {
  await mkdir('output', { recursive: true }); const root = await mkdtemp(join(resolve('output'), 'T3-smoke-fixture-')); roots.push(root);
  const tokenFile = join(root, 'token.txt'); const image = join(root, 'authorized.png'); const output = join(root, 'record', 'progress.json');
  await mkdir(join(root, 'record'));
  await writeFile(tokenFile, token); await writeFile(image, imageBytes);
  return { root, tokenFile, image, output };
}
async function api({ uploadFailsOnce = false, createResponseLostOnce = false } = {}) {
  const template = JSON.parse(await readFile('docs/examples/content-api/blog.json', 'utf8'));
  const creationKeys: string[] = []; const uploadKeys: string[] = [];
  const records = new Map<string, { id: string; revision: string; state: string; asset?: Record<string, unknown> }>();
  let creates = 0; let requests = 0;
  const server = createServer(async (request, response) => {
    requests++; const url = new URL(request.url!, 'http://localhost');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const send = (data: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (request.headers.authorization !== `Bearer ${token}`) return send({ error: { code: 'UNAUTHORIZED' } }, 401);
    if (url.pathname.endsWith('/schema')) return send({ kinds: ['blog', 'landing'] });
    if (url.pathname.includes('/templates/')) return send(template);
    if (url.pathname === '/api/content/v1/entries') return send({ entries: [] });
    if (url.pathname === '/api/content/v1/changes' && request.method === 'POST') {
      const key = String(request.headers['idempotency-key']); creationKeys.push(key);
      let row = records.get(key);
      if (!row) { creates++; row = { id: creates.toString(16).padStart(24, 'a'), revision: '1'.repeat(40), state: 'draft' }; records.set(key, row); }
      if (createResponseLostOnce) { createResponseLostOnce = false; request.socket.destroy(); return; }
      return send(row, 201);
    }
    const id = url.pathname.split('/')[5]; const row = [...records.values()].find(value => value.id === id);
    if (!row) return send({ error: { code: 'NOT_FOUND' } }, 404);
    if (url.pathname.endsWith('/assets') && request.method === 'POST') {
      uploadKeys.push(String(request.headers['idempotency-key']));
      if (uploadFailsOnce) { uploadFailsOnce = false; return send({ error: { code: 'TEMPORARY_FAILURE' } }, 503); }
      const bytes = Buffer.from(body.base64, 'base64');
      row.asset = { path: `/uploads/content-api/${id}/acceptance.png`, sha256: createHash('sha256').update(bytes).digest('hex'), width: 1, height: 1, bytes: bytes.length, mime: body.mime };
      row.revision = '2'.repeat(40); return send(row);
    }
    if (url.pathname.includes('/entries/blog/') && request.method === 'PUT') { row.revision = '3'.repeat(40); return send(row); }
    if (url.pathname.includes('/assets/')) { response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(imageBytes); }
    return send(row);
  });
  servers.push(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, creationKeys, uploadKeys, creates: () => creates, requests: () => requests };
}
async function run(config: Awaited<ReturnType<typeof fixture>>, origin: string, output = config.output, executable = script) {
  return new Promise<{ code: number | null; text: string }>((done, reject) => {
    const child = spawn(process.execPath, [executable, '--origin', origin, '--token-file', config.tokenFile, '--write-draft', '--image', config.image, '--out', output], { cwd: config.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', b => { text += b; }); child.stderr.on('data', b => { text += b; }); child.once('error', reject); child.once('exit', code => done({ code, text }));
  });
}
describe('recoverable content API acceptance CLI', () => {
  it('executes the documented Node example and resumes a failed upload with its persisted key', async () => {
    const files = await fixture(); const backend = await api({ uploadFailsOnce: true });
    const guide = await readFile('docs/CONTENT_API.md', 'utf8');
    const block = [...guide.matchAll(/```js\n([\s\S]*?)```/g)][0][1];
    const executable = join(files.root, 'documented-example.mjs');
    await writeFile(executable, block.replace('https://www.watermarkgemini.com/api/content/v1', backend.origin + '/api/content/v1'));
    await mkdir(join(files.root, '.secrets')); await writeFile(join(files.root, '.secrets', 'content-api-token.txt'), token);
    await writeFile(join(files.root, 'authorized-image.png'), imageBytes);
    await mkdir(join(files.root, 'docs', 'examples', 'content-api'), { recursive: true });
    await writeFile(join(files.root, 'docs', 'examples', 'content-api', 'blog.json'), await readFile('docs/examples/content-api/blog.json'));
    expect((await run(files, backend.origin, files.output, executable)).code).not.toBe(0);
    const second = await run(files, backend.origin, files.output, executable);
    expect(second.code, second.text).toBe(0); expect(backend.creates()).toBe(1);
    expect(new Set(backend.uploadKeys).size).toBe(1);
    const recovery = await readFile(join(files.root, 'output', 'content-draft-recovery.json'), 'utf8');
    expect(recovery).not.toContain(token); expect(JSON.parse(recovery).last.change.id).toBeTruthy();
  });
  it('persists the created change before upload failure and resumes without creating another draft', async () => {
    const files = await fixture(); const backend = await api({ uploadFailsOnce: true });
    expect((await run(files, backend.origin)).code).not.toBe(0);
    const first = await readFile(files.output, 'utf8').then(JSON.parse).catch(() => null);
    const second = await run(files, backend.origin);
    expect(second.code, second.text).toBe(0); expect(backend.creates()).toBe(1);
    expect(first.change.id).toBeTruthy(); expect(first.pending.step).toBe('asset');
    expect(backend.creationKeys).toHaveLength(1); expect(new Set(backend.uploadKeys).size).toBe(1);
    expect(await readFile(files.output, 'utf8')).not.toContain(token);
  });
  it('recovers an UNKNOWN create response with the same original key', async () => {
    const files = await fixture(); const backend = await api({ createResponseLostOnce: true });
    expect((await run(files, backend.origin)).code).not.toBe(0);
    const second = await run(files, backend.origin);
    expect(second.code, second.text).toBe(0); expect(backend.creates()).toBe(1);
    expect(backend.creationKeys).toHaveLength(2); expect(new Set(backend.creationKeys).size).toBe(1);
  });
  it('prepares writable recovery output before any remote request', async () => {
    const files = await fixture(); const backend = await api(); const parent = join(files.root, 'not-a-directory'); await writeFile(parent, 'blocked');
    expect((await run(files, backend.origin, join(parent, 'progress.json'))).code).not.toBe(0);
    expect(backend.creates()).toBe(0); expect(backend.requests()).toBe(0);
  });
  it('rejects resuming with a different input or origin before remote requests', async () => {
    const files = await fixture(); const backend = await api();
    const first = await run(files, backend.origin); expect(first.code, first.text).toBe(0);
    const before = backend.requests(); await writeFile(files.image, Buffer.concat([imageBytes, Buffer.from('different')]));
    expect((await run(files, backend.origin)).code).not.toBe(0); expect(backend.requests()).toBe(before);
    await writeFile(files.image, imageBytes); const other = await api();
    expect((await run(files, other.origin)).code).not.toBe(0); expect(other.requests()).toBe(0);
  });
});
