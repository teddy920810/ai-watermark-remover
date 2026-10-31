import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { cloudRunTriggerFromEnvironment } from '../../src/lib/runtime/cloud-run-trigger';
import { createProcessingRuntime, type ProcessingRuntime, type ProcessingRuntimeConfig } from '../../src/lib/runtime/processing-services';
import { imageCreditConfigFromEnvironment } from '../../src/lib/payments/image-credit-config';

type Environment = Record<string, string | undefined>;
type Mode = 'preflight' | 'process' | 'reconcile' | 'dispatch';
const legacyProviderEnvironment = z.object({
  WATERMARK_PROVIDER: z.enum(['mock', 'dewatermark']).default('mock'),
  DEWATERMARK_BASE_URL: z.url().default('https://platform.dewatermark.ai'),
  DEWATERMARK_PREDICT_MODE: z.enum(['3.0', '4.0']).default('4.0'),
  DEWATERMARK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  MOCK_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(0),
});
function required(source: Environment, name: string): string {
  const value = source[name];
  if (!value?.trim()) throw new Error(`Missing worker configuration: ${name}`);
  return value;
}
function modeFrom(source: Environment): Mode {
  const mode = source.MODE ?? 'dispatch';
  if (!['preflight', 'process', 'reconcile', 'dispatch'].includes(mode)) throw new Error('Worker mode is invalid');
  return mode as Mode;
}
function positive(source: Environment, name: string, fallback: number): number {
  const value = source[name] === undefined ? fallback : Number(source[name]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 60 * 60_000) throw new Error(`Invalid worker configuration: ${name}`);
  return value;
}
export function workerConfigFromEnvironment(source: Environment): ProcessingRuntimeConfig {
  const legacy = legacyProviderEnvironment.safeParse(source);
  if (!legacy.success) throw new Error('Invalid worker configuration: legacy provider');
  const mode = modeFrom(source);
  const databaseUrl = required(source, 'DATABASE_URL');
  const endpoint = source.R2_ENDPOINT ?? (source.R2_ACCOUNT_ID ? `https://${source.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : required(source, 'R2_ENDPOINT'));
  const providerMode = source.PROCESSING_PROVIDER ?? 'mock';
  if (!['mock', 'dewatermark'].includes(providerMode)) throw new Error('Invalid worker configuration: PROCESSING_PROVIDER');
  if (source.PROCESSING_ENABLED !== undefined && !['true', 'false'].includes(source.PROCESSING_ENABLED)) throw new Error('Invalid worker configuration: PROCESSING_ENABLED');
  const enabled = source.PROCESSING_ENABLED === 'true';
  if (enabled && providerMode === 'dewatermark') required(source, 'DEWATERMARK_API_KEY');
  const completeCloud = Boolean(source.GOOGLE_CLOUD_PROJECT && source.CLOUD_RUN_REGION && source.CLOUD_RUN_JOB);
  const trigger = mode === 'dispatch' || completeCloud ? cloudRunTriggerFromEnvironment(source) : undefined;
  if (mode === 'dispatch' && !trigger) throw new Error('Cloud Run configuration is required for dispatch');
  return {
    r2: { endpoint, accessKeyId: required(source, 'R2_ACCESS_KEY_ID'), secretAccessKey: required(source, 'R2_SECRET_ACCESS_KEY'), bucket: source.R2_BUCKET ?? 'watermark' },
    databaseUrl, providerMode: providerMode as 'mock' | 'dewatermark', apiKey: source.DEWATERMARK_API_KEY,
    legacyProvider: { mode: legacy.data.WATERMARK_PROVIDER, baseUrl: legacy.data.DEWATERMARK_BASE_URL, predictMode: legacy.data.DEWATERMARK_PREDICT_MODE, timeoutMs: legacy.data.DEWATERMARK_TIMEOUT_MS, mockDelayMs: legacy.data.MOCK_PROCESSING_DELAY_MS },
    ffprobePath: source.FFPROBE_PATH, enabled, priceVersion: source.PROCESSING_PRICE_VERSION ?? 'processing-v1', trigger,
    imageCredits: imageCreditConfigFromEnvironment(source),
  };
}
export interface WorkerDependencies {
  createRuntime?: (config: ProcessingRuntimeConfig) => ProcessingRuntime;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
export async function runWorker(source: Environment = process.env, dependencies: WorkerDependencies = {}): Promise<{ mode: Mode; status: string; id?: string; continuationRequired?: boolean }> {
  const mode = modeFrom(source);
  const config = workerConfigFromEnvironment(source);
  const maxRunMs = positive(source, 'WORKER_MAX_RUN_MS', 15 * 60_000);
  const pollMs = positive(source, 'WORKER_POLL_MS', 5_000);
  const jobId = source.JOB_ID;
  const ownerId = source.OWNER_ID;
  const dispatchId = source.DISPATCH_ID;
  if (mode !== 'dispatch' && (!jobId || !/^[A-Za-z0-9_-]{1,160}$/.test(jobId) || !ownerId || ownerId.length > 512 || /[\r\n\0]/.test(ownerId))) throw new Error('Worker task and owner identifiers are required');
  if (dispatchId && !/^[A-Za-z0-9_-]{1,160}$/.test(dispatchId)) throw new Error('Worker dispatch identifier is invalid');
  const runtime = (dependencies.createRuntime ?? createProcessingRuntime)(config);
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? (async (milliseconds: number) => { await delay(milliseconds); });
  const workerId = `worker-${randomUUID()}`;
  try {
    if (mode === 'dispatch') { await runtime.dispatch(); return { mode, status: 'dispatched' }; }
    if (mode === 'preflight') { const result = await runtime.runPreflight(ownerId!, jobId!); return { mode, status: result.status, id: result.id }; }
    const deadline = now() + maxRunMs;
    const maxSteps = Math.max(1, Math.ceil(maxRunMs / pollMs));
    let lastStatus = 'QUEUED';
    for (let step = 0; step < maxSteps && now() < deadline; step++) {
      const current = await runtime.service.get(ownerId!, jobId!);
      if (current.id !== jobId || current.ownerId !== ownerId) throw new Error('Worker task ownership does not match');
      if (dispatchId && current.dispatch && current.dispatch.id !== dispatchId) return { mode, status: 'superseded', id: jobId };
      if (['READY', 'FAILED', 'REFUNDED', 'EXPIRED'].includes(current.status)) return { mode, status: current.status, id: jobId };
      // Corrupt/incomplete UNKNOWN must never become a new charged submission.
      if (current.status === 'UNKNOWN' && !current.attempt) return { mode, status: 'UNKNOWN', id: jobId, continuationRequired: true };
      const result = await runtime.runJob(jobId!, workerId, dispatchId);
      lastStatus = result.status;
      if (['READY', 'FAILED', 'REFUNDED', 'EXPIRED'].includes(result.status)) return { mode, status: result.status, id: jobId };
      if (result.status === 'UNKNOWN') return { mode, status: result.status, id: jobId, continuationRequired: true };
      if (step + 1 < maxSteps && now() + pollMs < deadline) await sleep(pollMs);
    }
    // Reaching a local time budget does not fail or re-submit the durable task.
    return { mode, status: lastStatus, id: jobId, continuationRequired: true };
  } finally { await runtime.close(); }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try { console.log(JSON.stringify(await runWorker())); }
  catch { console.error(JSON.stringify({ status: 'worker_failed', message: 'Worker execution needs recovery; private configuration is redacted.' })); process.exitCode = 1; }
}
