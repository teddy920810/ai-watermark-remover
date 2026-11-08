/* global Buffer, URL, console, fetch, process */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function requireOk(url, fetcher) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
  return response;
}

export async function runPublicSmoke(baseUrl, fetcher = fetch) {
  await requireOk(`${baseUrl}/`, fetcher);
  await requireOk(`${baseUrl}/robots.txt`, fetcher);
  await requireOk(`${baseUrl}/sitemap.xml`, fetcher);

  const anonymousSigning = await fetcher(`${baseUrl}/api/v1/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ kind: 'image', contentType: 'image/png', byteSize: png.byteLength }),
  });
  if (anonymousSigning.status !== 401) {
    throw new Error(`/api/v1/uploads anonymous check returned ${anonymousSigning.status}; expected 401`);
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

export async function runProductionSmoke(environment = process.env, fetcher = fetch) {
  const baseUrl = (environment.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com').replace(/\/$/, '');
  await runPublicSmoke(baseUrl, fetcher);
  console.log(`Public production smoke passed for ${baseUrl}.`);
  return { status: 'public-passed' };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  if (process.argv.length > 2) {
    console.error('Public smoke accepts no functional arguments; use scripts/processing-acceptance.mjs with an explicitly reviewed budget.');
    process.exitCode = 1;
  } else await runProductionSmoke();
}

