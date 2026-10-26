/* global URL, console, fetch, process, AbortSignal, TextDecoder */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { AcceptanceBudget } from './lib/acceptance-budget.mjs';
import { inspectImage, inspectMask } from '../src/lib/media/image.ts';
import { probeVideo, validateVideoRequirements } from '../src/lib/media/video.ts';

const operations = ['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark'];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024; // This site's limit, not a claimed vendor limit.
export class ProcessingAcceptanceError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProcessingAcceptanceError'; this.code = code; Object.assign(this, details); }
}
const failure = (code, message, details) => new ProcessingAcceptanceError(code, message, details);
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw failure('protocol_invalid', `Invalid ${label} identifier`);
  return value;
}
function originFor(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('configuration', 'A valid base URL is required'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw failure('configuration', 'Use an HTTPS site origin or a local test origin');
  return url.origin;
}
function storageUrl(value, origin) {
  if (typeof value !== 'string' || !value.trim()) throw failure('protocol_invalid', 'Storage authorization is missing');
  let url;
  try { url = new URL(value, origin); } catch { throw failure('protocol_invalid', 'Storage authorization is invalid'); }
  const trusted = url.origin === origin || url.protocol === 'https:' && (url.hostname === 'r2.cloudflarestorage.com' || url.hostname.endsWith('.r2.cloudflarestorage.com'));
  if (!trusted || url.username || url.password || url.hash || url.port && url.origin !== origin) throw failure('protocol_invalid', 'Storage authorization is outside the expected private storage service');
  return url.toString();
}
async function bytesFrom(response, limit) {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body?.cancel().catch(() => undefined); throw failure('artifact_invalid', 'Downloaded artifact exceeds its size limit'); }
  if (!response.body) throw failure('artifact_invalid', 'Downloaded artifact is empty');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel().catch(() => undefined); throw failure('artifact_invalid', 'Downloaded artifact exceeds its size limit'); }
      chunks.push(value);
    }
  } catch (error) { if (error instanceof ProcessingAcceptanceError) throw error; throw failure('artifact_invalid', 'Downloaded artifact could not be read'); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function balances(body) {
  const value = body.balances ?? body;
  const result = { freeUses: value.freeUses ?? value.freeUsesRemaining, processingCredits: value.processingCredits ?? value.processingCreditsRemaining };
  if (!Object.values(result).every((amount) => Number.isSafeInteger(amount) && amount >= 0)) throw failure('protocol_invalid', 'Balance response must contain both allowance units');
  return result;
}
function metadata(artifact) {
  const value = artifact?.metadata ?? artifact;
  if (!value || !['image', 'video'].includes(value.kind) || !Number.isSafeInteger(value.width) || value.width <= 0 || !Number.isSafeInteger(value.height) || value.height <= 0 || !Number.isSafeInteger(value.byteSize) || value.byteSize <= 0) throw failure('protocol_invalid', 'Artifact metadata is incomplete');
  return value;
}
async function sampleFile(filename, maximum) {
  if (!filename) throw failure('configuration', 'A local sample file is required');
  const path = resolve(filename);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size <= 0 || info.size > maximum) throw failure('configuration', 'Sample file is missing or exceeds the site limit');
  return { path, bytes: new Uint8Array(await readFile(path)) };
}
async function writeEvidence(directory, record) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${record.recordId}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

/** No functional request occurs unless explicitly enabled. Never retries a POST. */
export async function runProcessingAcceptance(options = {}, dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const fetcher = dependencies.fetcher ?? fetch;
  const sleep = dependencies.sleep ?? delay;
  const inspectVideo = dependencies.probeVideo ?? probeVideo;
  const origin = originFor(options.baseUrl ?? environment.PROCESSING_ACCEPTANCE_BASE_URL ?? environment.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com');
  const timeoutMs = options.requestTimeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxWaitMs = options.maxWaitMs ?? 20 * 60_000;
  if (![timeoutMs, pollIntervalMs, maxWaitMs].every((value) => Number.isSafeInteger(value) && value > 0)) throw failure('configuration', 'Acceptance time limits must be positive integers');
  async function request(url, init = {}) {
    let response;
    try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw failure('request_failed', 'Acceptance request did not return a response'); }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw failure('http_error', `Acceptance endpoint returned HTTP ${response.status}`, { status: response.status }); }
    return response;
  }
  if (options.functional !== true) {
    for (const route of ['/', '/robots.txt', '/sitemap.xml', '/api/v1/capabilities']) await request(`${origin}${route}`);
    return { status: 'public-passed' };
  }
  const session = environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE ?? environment.SMOKE_SESSION_COOKIE;
  if (!session || /[\r\n]/.test(session)) throw failure('authentication_required', 'A functional acceptance session is required through the environment');
  const operation = options.operation ?? environment.PROCESSING_ACCEPTANCE_OPERATION ?? 'image-watermark';
  if (!operations.includes(operation)) throw failure('configuration', 'Unknown processing operation');
  const expectedAmount = options.expectedAmount ?? (environment.PROCESSING_ACCEPTANCE_EXPECTED_AMOUNT !== undefined ? Number(environment.PROCESSING_ACCEPTANCE_EXPECTED_AMOUNT) : undefined);
  const expectedUnit = options.expectedUnit ?? environment.PROCESSING_ACCEPTANCE_EXPECTED_UNIT;
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0 || !['freeUses', 'processingCredits'].includes(expectedUnit)) throw failure('amount_confirmation_required', 'Confirm the exact expected amount and allowance unit before functional acceptance');
  const kind = operation === 'video-watermark' ? 'video' : 'image';
  const imageLimit = options.imageLimit ?? Number(environment.PROCESSING_ACCEPTANCE_IMAGE_LIMIT ?? 5);
  if (!Number.isInteger(imageLimit) || imageLimit < 0 || imageLimit > 10) throw failure('budget_authorization', 'Image acceptance limit must match the explicit supported authorization');
  const ledgerPath = resolve(options.ledgerPath ?? environment.ACCEPTANCE_LEDGER_PATH ?? 'output/acceptance/budget.json');
  const budget = dependencies.budget ?? new AcceptanceBudget(ledgerPath, { image: imageLimit, video: 5 });
  const remaining = (await budget.summary()).remaining[kind];
  if (remaining < 1) throw failure('budget_exhausted', `Real ${kind} acceptance budget exhausted`);
  const reportDir = resolve(options.reportDir ?? 'output/acceptance/site-records');
  const headers = { Cookie: session, Origin: origin, 'Content-Type': 'application/json' };
  async function api(route, body) {
    const response = await request(`${origin}${route}`, { headers, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    try { return JSON.parse(new TextDecoder().decode(await bytesFrom(response, 1_048_576))); }
    catch (error) { if (error instanceof ProcessingAcceptanceError) throw error; throw failure('protocol_invalid', 'Acceptance endpoint returned invalid JSON'); }
  }
  const pollLimit = Math.max(1, Math.ceil(maxWaitMs / pollIntervalMs));
  async function uploadAsset(bytes, mediaKind, contentType, inputArtifactId) {
    const signed = await api('/api/v1/uploads', { kind: mediaKind, contentType, byteSize: bytes.byteLength, ...(inputArtifactId ? { inputArtifactId } : {}) });
    const id = identifier(signed.upload?.id ?? signed.id, 'upload');
    const url = storageUrl(signed.uploadUrl ?? signed.url, origin);
    await request(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
    await api(`/api/v1/uploads/${id}/complete`, {});
    for (let attempt = 0; attempt < pollLimit; attempt++) {
      const response = await api(`/api/v1/uploads/${id}`);
      const upload = response.upload ?? response;
      if (upload.status === 'ready') {
        const artifact = upload.artifact ?? response.artifact;
        identifier(artifact?.id ?? upload.artifactId, 'artifact');
        if (!artifact?.metadata) throw failure('protocol_invalid', 'Preflight must return actual artifact metadata');
        metadata(artifact); return artifact;
      }
      if (upload.status === 'failed' || upload.status === 'expired') throw failure('preflight_failed', 'Sample did not pass server media validation');
      await sleep(pollIntervalMs);
    }
    throw failure('preflight_pending', 'Preflight did not complete within the acceptance window');
  }
  const before = balances(await api('/api/v1/me'));
  let input; let sourceInfo; let mask; let parentJobId;
  const ffprobePath = options.ffprobePath ?? environment.FFPROBE_PATH;
  if (operation === 'image-refine') {
    parentJobId = identifier(options.parentJobId ?? environment.PROCESSING_ACCEPTANCE_PARENT_JOB_ID, 'parent task');
    const response = await api(`/api/v1/jobs/${parentJobId}`); const parent = response.job ?? response;
    if (parent.status !== 'READY' || parent.result?.canRefine !== true || parent.isDemo !== false) throw failure('parent_unavailable', 'A real completed result supporting refinement is required');
    input = parent.result; sourceInfo = metadata(input);
    const parentArtifactId = options.parentArtifactId ?? environment.PROCESSING_ACCEPTANCE_PARENT_ARTIFACT_ID;
    if (parentArtifactId && parentArtifactId !== input.id) throw failure('parent_unavailable', 'Parent artifact does not match the selected task');
  } else {
    const sample = await sampleFile(options.samplePath ?? environment.PROCESSING_ACCEPTANCE_SAMPLE_PATH, kind === 'video' ? MAX_VIDEO : MAX_IMAGE);
    if (kind === 'video') {
      if (!ffprobePath) throw failure('configuration', 'FFPROBE_PATH is required for video acceptance');
      const info = await inspectVideo(sample.path, { ffprobePath }); validateVideoRequirements(info);
      sourceInfo = { kind, contentType: 'video/mp4', byteSize: sample.bytes.byteLength, width: info.width, height: info.height, durationSeconds: info.durationSeconds, fps: info.frameRate, hasAudio: info.audio.length > 0 };
    } else {
      const info = await inspectImage(sample.bytes);
      if (Math.max(info.width, info.height) > 6000) throw failure('configuration', 'Image sample exceeds the supported input dimensions');
      sourceInfo = { kind, contentType: info.mimeType, byteSize: sample.bytes.byteLength, width: info.width, height: info.height };
    }
    input = await uploadAsset(sample.bytes, kind, sourceInfo.contentType);
    const server = metadata(input);
    if (server.width !== sourceInfo.width || server.height !== sourceInfo.height || server.byteSize !== sourceInfo.byteSize || server.contentType !== sourceInfo.contentType) throw failure('preflight_mismatch', 'Server media properties do not match the actual sample');
  }
  const maskPath = options.maskPath ?? environment.PROCESSING_ACCEPTANCE_MASK_PATH;
  if (maskPath) {
    if (!['image-refine', 'video-watermark'].includes(operation)) throw failure('configuration', 'This operation does not accept a mask');
    const sample = await sampleFile(maskPath, MAX_IMAGE);
    await inspectMask(sample.bytes, { width: sourceInfo.width, height: sourceInfo.height });
    mask = await uploadAsset(sample.bytes, 'mask', 'image/png', input.id);
  } else if (operation === 'image-refine') throw failure('configuration', 'Refinement acceptance requires a binary PNG mask');
  const quoteBody = await api('/api/v1/quotes', { operation, inputArtifactId: input.id, ...(mask ? { maskArtifactId: mask.id } : {}), ...(parentJobId ? { parentJobId } : {}) });
  const quote = quoteBody.quote ?? quoteBody;
  identifier(quote.id, 'quote');
  if (quote.isDemo !== false) throw failure('demo_quote', 'Functional production acceptance requires a real-provider quote');
  if (quote.amount !== expectedAmount || quote.unit !== expectedUnit) throw failure('quote_changed', 'Quoted amount or allowance unit differs from the explicit confirmation');
  if (before[quote.unit] < quote.amount) throw failure('insufficient_allowance', 'Acceptance account has insufficient allowance');

  const recordId = await budget.reserve(kind, `site ${operation} functional acceptance`);
  const clientOperationKey = randomUUID();
  let record = { recordId, clientOperationKey, operation, status: 'started', amount: quote.amount, unit: quote.unit, creditsBefore: before[quote.unit] };
  await writeEvidence(reportDir, record);
  let submissionStarted = false; let jobId;
  try {
    submissionStarted = true;
    const created = await api('/api/v1/jobs', { quoteId: quote.id, idempotencyKey: clientOperationKey });
    jobId = identifier(created.job?.id ?? created.id, 'task');
    record = { ...record, jobId };
    await writeEvidence(reportDir, record);
    let job;
    for (let attempt = 0; attempt < pollLimit; attempt++) {
      const response = await api(`/api/v1/jobs/${jobId}`); job = response.job ?? response;
      if (job.status === 'UNKNOWN') {
        record = { ...record, status: 'unknown', reason: 'provider_status_unknown' };
        await budget.finish(recordId, { status: 'unknown', note: 'Existing task awaits reconciliation; no new submission was sent.' });
        await writeEvidence(reportDir, record); return record;
      }
      if (job.status === 'READY') break;
      if (['FAILED', 'REFUNDED', 'EXPIRED'].includes(job.status)) throw failure('processing_failed', 'Processing did not produce an available result');
      await sleep(pollIntervalMs);
    }
    if (job?.status !== 'READY') throw failure('processing_pending', 'Existing task did not complete within the acceptance window');
    const charge = job.charge ?? { status: job.chargeStatus, amount: job.amount, unit: job.unit };
    if (job.isDemo !== false || charge.status !== 'settled') throw failure('protocol_invalid', 'Ready task must identify real processing and settled allowance');
    if (charge.amount !== quote.amount || charge.unit !== quote.unit) throw failure('credit_invariant', 'Settled task charge differs from the confirmed quote');
    const expected = metadata(job.result);
    const download = await api(`/api/v1/jobs/${jobId}/download`);
    const response = await request(storageUrl(download.downloadUrl ?? download.url, origin), { headers: { Origin: origin } });
    const bytes = await bytesFrom(response, kind === 'video' ? MAX_VIDEO : 48 * 1024 * 1024);
    let artifact;
    try {
      if (kind === 'image') {
        const info = await inspectImage(bytes, { maxBytes: 48 * 1024 * 1024 });
        if (info.format !== 'jpeg') throw new Error('Not JPEG');
        artifact = { format: info.format, contentType: info.mimeType, width: info.width, height: info.height, byteSize: bytes.byteLength };
      } else {
        const directory = await mkdtemp(join(tmpdir(), 'watermark-download-'));
        try {
          const file = join(directory, 'output.mp4'); await writeFile(file, bytes);
          const info = await inspectVideo(file, { ffprobePath }); validateVideoRequirements(info);
          artifact = { format: 'mp4', contentType: 'video/mp4', width: info.width, height: info.height, byteSize: bytes.byteLength, durationSeconds: info.durationSeconds, fps: info.frameRate, hasAudio: info.audio.length > 0 };
          if (artifact.hasAudio !== sourceInfo.hasAudio || Math.abs(artifact.durationSeconds - sourceInfo.durationSeconds) > 0.25) throw new Error('Output media properties differ');
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      if (artifact.width !== expected.width || artifact.height !== expected.height || artifact.byteSize !== expected.byteSize || artifact.contentType !== expected.contentType || response.headers.get('content-type')?.split(';')[0] !== artifact.contentType) throw new Error('Output metadata differs');
    } catch { throw failure('artifact_invalid', 'Downloaded artifact failed actual media validation'); }
    const after = balances(await api('/api/v1/me'));
    for (const unit of ['freeUses', 'processingCredits']) if (after[unit] !== before[unit] - (unit === quote.unit ? quote.amount : 0)) throw failure('credit_invariant', 'Allowance changed by more than the single confirmed quote');
    record = { ...record, status: 'passed', creditsAfter: after[quote.unit], artifact };
    await budget.finish(recordId, { status: 'passed', note: 'Actual artifact and one quoted debit verified.', creditsBefore: before[quote.unit], creditsAfter: after[quote.unit], width: artifact.width, height: artifact.height, ...(kind === 'video' ? { durationSeconds: artifact.durationSeconds, hasAudio: artifact.hasAudio } : {}) });
    await writeEvidence(reportDir, record); return record;
  } catch (error) {
    const submissionUnknown = submissionStarted && !jobId && !(error instanceof ProcessingAcceptanceError && error.code === 'http_error' && error.status >= 400 && error.status < 500 && error.status !== 408);
    const unknown = submissionUnknown || error instanceof ProcessingAcceptanceError && (['request_failed', 'processing_pending'].includes(error.code) || error.code === 'http_error' && (error.status >= 500 || error.status === 408));
    const code = submissionUnknown ? 'submission_unknown' : error instanceof ProcessingAcceptanceError ? error.code : 'acceptance_failed';
    record = { ...record, status: unknown ? 'unknown' : 'failed', reason: code };
    await budget.finish(recordId, { status: unknown ? 'unknown' : 'failed', note: unknown ? 'Existing operation requires reconciliation; no resubmission was sent.' : 'Acceptance failed; the reserved test slot remains consumed.' });
    await writeEvidence(reportDir, record);
    throw failure(code, submissionUnknown ? 'Job submission outcome is unknown; reconcile its saved operation key before any new run' : error instanceof ProcessingAcceptanceError ? error.message : 'Processing acceptance failed', { recordId });
  }
}

export function acceptanceCliOptions(args) {
  const result = { functional: false };
  const fields = { '--base-url': 'baseUrl', '--operation': 'operation', '--sample': 'samplePath', '--mask': 'maskPath', '--parent-job': 'parentJobId', '--parent-artifact': 'parentArtifactId', '--expected-amount': 'expectedAmount', '--expected-unit': 'expectedUnit', '--image-limit': 'imageLimit', '--ledger': 'ledgerPath', '--report-dir': 'reportDir', '--ffprobe': 'ffprobePath', '--max-wait-ms': 'maxWaitMs', '--poll-interval-ms': 'pollIntervalMs' };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--functional') { result.functional = true; continue; }
    if (!fields[argument] || !args[index + 1] || args[index + 1].startsWith('--')) throw failure('configuration', 'Unknown or incomplete acceptance argument');
    const field = fields[argument]; const value = args[++index];
    result[field] = ['expectedAmount', 'imageLimit', 'maxWaitMs', 'pollIntervalMs'].includes(field) ? Number(value) : value;
  }
  return result;
}
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try { const result = await runProcessingAcceptance(acceptanceCliOptions(process.argv.slice(2))); console.log(JSON.stringify(result, null, 2)); if (result.status === 'unknown') process.exitCode = 2; }
  catch (error) { console.error(JSON.stringify({ status: 'failed', code: error instanceof ProcessingAcceptanceError ? error.code : 'acceptance_failed', ...(error instanceof ProcessingAcceptanceError && error.recordId ? { recordId: error.recordId } : {}), message: error instanceof ProcessingAcceptanceError ? error.message : 'Processing acceptance failed' })); process.exitCode = 1; }
}
