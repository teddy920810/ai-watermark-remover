/* global Buffer, URL, console, fetch, process */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorizeFunctionalAcceptance } from './lib/acceptance-budget.mjs';

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

export async function runAuthenticatedSmoke(baseUrl, sessionCookie, fetcher = fetch, options = {}) {
  if (!sessionCookie) {
    if (options.requireAuthentication) throw new Error('A production smoke session cookie is required.');
    return { status: 'skipped' };
  }
  const { runProcessingAcceptance } = await import('./processing-acceptance.mjs');
  return runProcessingAcceptance({ ...options, functional: true, baseUrl }, { fetcher, environment: { ...(options.environment ?? process.env), PROCESSING_ACCEPTANCE_SESSION_COOKIE: sessionCookie } });
}

export async function runProductionSmoke(environment = process.env, fetcher = fetch, options = {}) {
  const baseUrl = (environment.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com').replace(/\/$/, '');
  const sessionCookie = environment.SMOKE_SESSION_COOKIE ?? environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE ?? '';
  if (options.requireAuthentication) await authorizeFunctionalAcceptance({ ...options, baseUrl }, { ...environment, PROCESSING_ACCEPTANCE_SESSION_COOKIE: sessionCookie });
  await runPublicSmoke(baseUrl, fetcher);
  console.log(`Public production smoke passed for ${baseUrl}.`);

  if (!options.requireAuthentication) return { status: 'public-passed' };

  const authenticated = await runAuthenticatedSmoke(baseUrl, sessionCookie, fetcher, { ...options, environment });
  if (authenticated.status === 'skipped') {
    console.warn('Authenticated production smoke SKIPPED: SMOKE_SESSION_COOKIE is not configured.');
    return authenticated;
  }
  if (authenticated.status !== 'passed') throw new Error('Authenticated production smoke is not confirmed; reconcile the original operation without retrying.');

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

