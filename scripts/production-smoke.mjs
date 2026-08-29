/* global Buffer, URL, console, fetch, process, setTimeout */

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { inspectPngArtifact } from './lib/png-artifact.mjs';

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
  const anonymousCheckIn = await fetcher(`${baseUrl}/api/me/check-in`, {
    method: 'POST',
    headers: { Origin: baseUrl },
  });
  if (anonymousCheckIn.status !== 401) {
    throw new Error(`/api/me/check-in anonymous check returned ${anonymousCheckIn.status}; expected 401`);
  }
}

async function backgroundRemovalFixture() {
  const source = fileURLToPath(new URL('../public/uploads/background-remover-product-photo.png', import.meta.url));
  return sharp(source)
    .extract({ left: 250, top: 180, width: 650, height: 700 })
    .resize({ width: 512, height: 512, fit: 'inside' })
    .png()
    .toBuffer();
}

function benefitBalance(body) {
  const balance = body.balance ?? body.freeUsesRemaining;
  if (!Number.isInteger(balance)) throw new Error('Benefits response is missing an integer balance.');
  return balance;
}

export async function runAuthenticatedSmoke(baseUrl, sessionCookie, fetcher = fetch, options = {}) {
  if (!sessionCookie) {
    if (options.requireAuthentication) throw new Error('A production smoke session cookie is required.');
    return { status: 'skipped' };
  }

  const operation = options.operation ?? 'watermark-removal';
  const fixture = options.fixture ?? (operation === 'background-removal' ? await backgroundRemovalFixture() : png);

  const apiHeaders = { 'Content-Type': 'application/json', Cookie: sessionCookie };
  await json(`${baseUrl}/api/me/benefits`, fetcher, { headers: { Cookie: sessionCookie } });
  const checkedIn = await json(`${baseUrl}/api/me/check-in`, fetcher, {
    method: 'POST',
    headers: { Cookie: sessionCookie, Origin: baseUrl },
  });
  const balanceBefore = benefitBalance(checkedIn);
  if (balanceBefore < 1) throw new Error('The production smoke account has no available test credit.');

  const signed = await json(`${baseUrl}/api/upload-url`, fetcher, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ contentType: 'image/png', size: fixture.byteLength }),
  });

  const upload = await fetcher(signed.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: fixture });
  if (!upload.ok) throw new Error(`R2 PUT returned ${upload.status}`);

  const created = await json(`${baseUrl}/api/jobs`, fetcher, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ inputKey: signed.key, operation }),
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

  let result;
  for (const [index, signedUrl] of [job.resultUrl, job.downloadUrl].entries()) {
    const response = await requireOk(signedUrl, fetcher, { headers: { Origin: baseUrl } });
    if (response.headers.get('access-control-allow-origin') !== baseUrl) {
      throw new Error('R2 result download is missing the production CORS origin.');
    }
    const inspected = await inspectPngArtifact(await response.arrayBuffer(), {
      requireTransparency: operation === 'background-removal',
    });
    if (index === 0) result = inspected;
  }

  const benefitsAfter = await json(`${baseUrl}/api/me/benefits`, fetcher, { headers: { Cookie: sessionCookie } });
  const balanceAfter = benefitBalance(benefitsAfter);
  if (balanceAfter !== balanceBefore - 1) {
    throw new Error(`Production smoke credit invariant failed: expected ${balanceBefore - 1}, received ${balanceAfter}.`);
  }

  return { status: 'passed', operation, balanceBefore, balanceAfter, result };
}

export async function runProductionSmoke(environment = process.env, fetcher = fetch, options = {}) {
  const baseUrl = (environment.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com').replace(/\/$/, '');
  await runPublicSmoke(baseUrl, fetcher);
  console.log(`Public production smoke passed for ${baseUrl}.`);

  if (!options.requireAuthentication) return { status: 'public-passed' };

  const authenticated = await runAuthenticatedSmoke(baseUrl, environment.SMOKE_SESSION_COOKIE ?? '', fetcher, options);
  if (authenticated.status === 'skipped') {
    console.warn('Authenticated production smoke SKIPPED: SMOKE_SESSION_COOKIE is not configured.');
    return authenticated;
  }

  console.log(`Authenticated ${authenticated.operation} production smoke passed for ${baseUrl}; artifact and credit invariants passed, and sensitive URLs were redacted.`);
  return authenticated;
}

function cliOptions(argumentsList) {
  const operationIndex = argumentsList.indexOf('--operation');
  return {
    requireAuthentication: argumentsList.includes('--require-auth'),
    operation: operationIndex >= 0 ? argumentsList[operationIndex + 1] : undefined,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await runProductionSmoke(process.env, fetch, cliOptions(process.argv.slice(2)));

