/* global Buffer, URL, console, fetch, process, setTimeout */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function requireOk(url, fetcher, init) {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
  return response;
}

async function json(url, fetcher, init) {
  const response = await fetcher(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}: ${body.error ?? 'unknown error'}`);
  return body;
}

export async function runPublicSmoke(baseUrl, fetcher = fetch) {
  await requireOk(`${baseUrl}/`, fetcher);
  await requireOk(`${baseUrl}/robots.txt`, fetcher);
  await requireOk(`${baseUrl}/sitemap.xml`, fetcher);

  const anonymousSigning = await fetcher(`${baseUrl}/api/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'image/png', size: png.byteLength }),
  });
  if (anonymousSigning.status !== 401) {
    throw new Error(`/api/upload-url anonymous check returned ${anonymousSigning.status}; expected 401`);
  }

  const anonymousBenefits = await fetcher(`${baseUrl}/api/me/benefits`);
  if (anonymousBenefits.status !== 401) {
    throw new Error(`/api/me/benefits anonymous check returned ${anonymousBenefits.status}; expected 401`);
  }
  const anonymousCheckIn = await fetcher(`${baseUrl}/api/me/check-in`, { method: 'POST' });
  if (anonymousCheckIn.status !== 401) {
    throw new Error(`/api/me/check-in anonymous check returned ${anonymousCheckIn.status}; expected 401`);
  }
}

export async function runAuthenticatedSmoke(baseUrl, sessionCookie, fetcher = fetch) {
  if (!sessionCookie) return { status: 'skipped' };

  const apiHeaders = { 'Content-Type': 'application/json', Cookie: sessionCookie };
  const signed = await json(`${baseUrl}/api/upload-url`, fetcher, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ contentType: 'image/png', size: png.byteLength }),
  });

  const upload = await fetcher(signed.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
  if (!upload.ok) throw new Error(`R2 PUT returned ${upload.status}`);

  const created = await json(`${baseUrl}/api/jobs`, fetcher, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ inputKey: signed.key }),
  });

  let job;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    job = await json(`${baseUrl}/api/jobs/${created.id}`, fetcher, { headers: { Cookie: sessionCookie } });
    if (job.status === 'completed' || job.status === 'failed') break;
    await new Promise((done) => setTimeout(done, 1_000));
  }

  if (job?.status !== 'completed' || !job.resultUrl || !job.downloadUrl) {
    throw new Error(`Production job did not complete: ${job?.status ?? 'unknown'}`);
  }

  for (const signedUrl of [job.resultUrl, job.downloadUrl]) await requireOk(signedUrl, fetcher);
  return { status: 'passed' };
}

export async function runProductionSmoke(environment = process.env, fetcher = fetch) {
  const baseUrl = (environment.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com').replace(/\/$/, '');
  await runPublicSmoke(baseUrl, fetcher);
  console.log(`Public production smoke passed for ${baseUrl}.`);

  const authenticated = await runAuthenticatedSmoke(baseUrl, environment.SMOKE_SESSION_COOKIE ?? '', fetcher);
  if (authenticated.status === 'skipped') {
    console.warn('Authenticated production smoke SKIPPED: SMOKE_SESSION_COOKIE is not configured.');
    return authenticated;
  }

  console.log(`Authenticated production smoke passed for ${baseUrl}; signed URLs and object keys were redacted.`);
  return authenticated;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await runProductionSmoke();

