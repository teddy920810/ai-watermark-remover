/* global Buffer, URL, console, fetch, process, setTimeout */

const baseUrl = (process.env.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com').replace(/\/$/, '');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}: ${body.error ?? 'unknown error'}`);
  return body;
}

const signed = await json(`${baseUrl}/api/upload-url`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contentType: 'image/png', size: png.byteLength }),
});

const upload = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
if (!upload.ok) throw new Error(`R2 PUT returned ${upload.status}`);

const created = await json(`${baseUrl}/api/jobs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ inputKey: signed.key }),
});

let job;
for (let attempt = 0; attempt < 10; attempt += 1) {
  job = await json(`${baseUrl}/api/jobs/${created.id}`);
  if (job.status === 'completed' || job.status === 'failed') break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

if (job?.status !== 'completed' || !job.resultUrl || !job.downloadUrl) {
  throw new Error(`Production job did not complete: ${job?.status ?? 'unknown'}`);
}

for (const url of [job.resultUrl, job.downloadUrl]) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Signed result request returned ${response.status}`);
}

console.log(`Production smoke passed for ${baseUrl}; signed URLs and object keys were redacted.`);

