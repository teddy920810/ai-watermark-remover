/* global console, process, URL, AbortSignal */
import { S3Client, GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildProcessingMediaLifecycle, lifecycleFingerprint, summarizeLifecycle } from './lib/processing-lifecycle.mjs';

export class ProcessingLifecycleError extends Error {
  constructor(code, message) { super(message); this.name = 'ProcessingLifecycleError'; this.code = code; }
}
export function lifecycleCliOptions(args) {
  if (!Array.isArray(args) || args.length > 1 || args.some(argument => !['--apply', '--dry-run'].includes(argument))) throw new ProcessingLifecycleError('configuration', 'Use the default dry run, --dry-run, or --apply.');
  return { apply: args[0] === '--apply' };
}
function configurationFrom(source) {
  const endpoint = source.R2_ENDPOINT || (source.R2_ACCOUNT_ID ? `https://${source.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  if (!endpoint || !source.R2_ACCESS_KEY_ID || !source.R2_SECRET_ACCESS_KEY) throw new ProcessingLifecycleError('configuration', 'Private R2 configuration is unavailable.');
  return { endpoint, bucket: source.R2_BUCKET || 'watermark', accessKeyId: source.R2_ACCESS_KEY_ID, secretAccessKey: source.R2_SECRET_ACCESS_KEY };
}
function createClient(configuration) {
  let url;
  try { url = new URL(configuration.endpoint); } catch { throw new ProcessingLifecycleError('configuration', 'R2 endpoint configuration is invalid.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9]+(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ProcessingLifecycleError('configuration', 'R2 endpoint configuration is invalid.');
  return new S3Client({ endpoint: configuration.endpoint, region: 'auto', forcePathStyle: true, maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey } });
}
function readFailure(error) {
  const status = error?.$metadata?.httpStatusCode;
  if (status === 401 || status === 403) return new ProcessingLifecycleError('permission', 'Lifecycle configuration permission is unavailable.');
  if (status === 501 || ['NotImplemented', 'UnsupportedOperation'].includes(error?.name)) return new ProcessingLifecycleError('unsupported', 'Lifecycle configuration is unsupported.');
  return new ProcessingLifecycleError('read_failed', 'Lifecycle configuration could not be read; no new update was sent.');
}
async function backupPolicy(policy) {
  const directory = resolve('output', 'r2-config'); await mkdir(directory, { recursive: true });
  const file = join(directory, `lifecycle-before-${Date.now()}-${randomUUID()}.json`);
  await writeFile(file, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}
export async function runProcessingLifecycle(options = {}, dependencies = {}) {
  if (options.apply !== undefined && typeof options.apply !== 'boolean') throw new ProcessingLifecycleError('configuration', 'Apply must be explicitly true.');
  const configuration = dependencies.configuration ?? configurationFrom(dependencies.env ?? process.env);
  const client = dependencies.client ?? createClient(configuration);
  const read = async () => {
    try {
      const response = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: configuration.bucket }), { abortSignal: AbortSignal.timeout(15000) });
      if (!Array.isArray(response.Rules)) throw new Error();
      return { Rules: response.Rules };
    } catch (error) {
      if (error?.name === 'NoSuchLifecycleConfiguration') return { Rules: [] };
      throw readFailure(error);
    }
  };
  try {
    const existing = await read();
    let plan;
    try { plan = buildProcessingMediaLifecycle(existing); }
    catch (error) {
      const allowed = ['Lifecycle policy is invalid', 'Existing expiration reaches processing recovery records', 'Managed lifecycle identifier already has another meaning', 'Lifecycle rule limit would be exceeded'];
      throw new ProcessingLifecycleError('unsafe_policy', allowed.includes(error?.message) ? error.message : 'Lifecycle policy requires manual review.');
    }
    const summary = { addedPrefixes: plan.addedPrefixes, rules: summarizeLifecycle(plan.policy), objectWrites: 0, physicalDeletion: 'Expires after one day; background deletion is usually within another 24 hours and can take longer.' };
    if (!options.apply) return { status: 'dry_run', configurationWrites: 0, ...summary };
    if (!plan.changed) return { status: 'already_configured', configurationWrites: 0, ...summary };
    let backup;
    try { backup = await (dependencies.backup ?? backupPolicy)(existing); }
    catch { throw new ProcessingLifecycleError('backup_failed', 'Lifecycle backup failed; no update was sent.'); }
    try {
      await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: configuration.bucket, LifecycleConfiguration: plan.policy }), { abortSignal: AbortSignal.timeout(15000) });
    } catch (error) {
      if ([401, 403].includes(error?.$metadata?.httpStatusCode)) throw new ProcessingLifecycleError('permission', 'Lifecycle update was refused by the configured account.');
      if (error?.$metadata?.httpStatusCode === 501) throw new ProcessingLifecycleError('unsupported', 'Lifecycle configuration is unsupported.');
      throw new ProcessingLifecycleError('apply_unknown', 'Lifecycle update outcome is unknown; read configuration before any new apply.');
    }
    let verified;
    try { verified = await read(); }
    catch { throw new ProcessingLifecycleError('verification_failed', 'Lifecycle update was sent; read-back verification is unavailable. Do not repeat apply.'); }
    if (lifecycleFingerprint(verified) !== lifecycleFingerprint(plan.policy)) throw new ProcessingLifecycleError('verification_failed', 'Lifecycle read-back differs from the preserved policy; review configuration without repeating apply.');
    return { status: 'applied_verified', configurationWrites: 1, ...summary, ...(backup ? { backup } : {}) };
  } finally { if (!dependencies.client) client.destroy(); }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    const options = lifecycleCliOptions(process.argv.slice(2));
    if (existsSync('.env.local')) loadEnvFile('.env.local');
    console.log(JSON.stringify(await runProcessingLifecycle(options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: error instanceof ProcessingLifecycleError ? error.code : 'configuration_failed', message: error instanceof ProcessingLifecycleError ? error.message : 'Lifecycle configuration could not be completed; private diagnostics are redacted.' })); process.exitCode = 1;
  }
}
