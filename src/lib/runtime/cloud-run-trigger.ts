import { randomUUID } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/oidc';
import { ExternalAccountClient } from 'google-auth-library';
import type { ExecutionTrigger } from './processing-services';

// Official contracts: jobs.run returns an LRO, not a completed business task.
// https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run
// https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions/get
interface CloudState {
  name?: string;
  done?: boolean;
  metadata?: CloudState;
  response?: CloudState;
  error?: unknown;
  completionTime?: string;
  runningCount?: number;
  conditions?: { type?: string; state?: string }[];
  template?: { containers?: { env?: { name?: string; value?: string }[] }[] };
  executions?: CloudState[];
  nextPageToken?: string;
}
interface GoogleCredentials { client_email: string; private_key: string; project_id?: string; type?: 'service_account' }
export interface VercelGoogleFederation {
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
  audience?: string;
}
export interface CloudRunTriggerOptions {
  projectId: string;
  projectNumber?: string;
  region: string;
  jobName: string;
  containerName?: string;
  credentials?: GoogleCredentials;
  federation?: VercelGoogleFederation;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  id?: () => string;
  monitorDelayMs?: number;
  requestTimeoutMs?: number;
}
export class CloudRunTriggerError extends Error {
  constructor(message: string, readonly kind: 'authorization' | 'other' = 'other') { super(message); this.name = 'CloudRunTriggerError'; }
}

export function createVercelGoogleTokenProvider(options: VercelGoogleFederation): () => Promise<string> {
  const GCP_PROJECT_NUMBER = options.projectNumber;
  const GCP_SERVICE_ACCOUNT_EMAIL = options.serviceAccountEmail;
  const GCP_WORKLOAD_IDENTITY_POOL_ID = options.poolId;
  const GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = options.providerId;
  if (!/^\d{1,30}$/.test(GCP_PROJECT_NUMBER) || !/^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(GCP_SERVICE_ACCOUNT_EMAIL) || ![GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID].every((value) => /^[a-z0-9][a-z0-9_-]{0,127}$/.test(value))) throw new CloudRunTriggerError('Workload identity federation configuration is invalid');

  // Preserve Vercel's official custom-audience ExternalAccountClient contract.
  // https://vercel.com/docs/oidc/gcp (updated 2026-09-01)
  // The supplier runs inside the request, never at module load, and receives a
  // fresh short-lived Vercel subject token when Google's client needs one.
  const GCP_AUDIENCE = `https://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
  if (options.audience && options.audience !== GCP_AUDIENCE) throw new CloudRunTriggerError('Workload identity federation audience does not match its provider');
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: GCP_AUDIENCE,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () =>
        getVercelOidcToken({
          audience: GCP_AUDIENCE,
        }),
    },
  });
  if (!authClient) throw new CloudRunTriggerError('Workload identity federation client is unavailable');
  return async () => {
    try {
      const result = await authClient.getAccessToken();
      if (!result.token) throw new Error();
      return result.token;
    } catch { throw new CloudRunTriggerError('Cloud execution credentials are unavailable', 'authorization'); }
  };
}

function googleTokenProvider(credentials?: GoogleCredentials): () => Promise<string> {
  let provider: Promise<{ getAccessToken(): Promise<string | null | undefined> }> | undefined;
  return async () => {
    try {
      const active = provider ??= import('google-auth-library').then(({ GoogleAuth }) => new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'], ...(credentials ? { credentials } : {}) }));
      const token = await (await active).getAccessToken();
      if (!token) throw new Error();
      return token;
    } catch { throw new CloudRunTriggerError('Cloud execution credentials are unavailable'); }
  };
}
function object(value: unknown): CloudState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudRunTriggerError('Cloud execution status is unavailable');
  return value as CloudState;
}
async function responseJson(response: Response): Promise<CloudState> {
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new CloudRunTriggerError('Cloud execution status is unavailable'); }
  const reader = response.body?.getReader();
  if (!reader) throw new CloudRunTriggerError('Cloud execution status is unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel().catch(() => undefined); throw new Error(); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { throw new CloudRunTriggerError('Cloud execution status is unavailable'); }
  finally { reader.releaseLock(); }
}

export function createCloudRunTrigger(options: CloudRunTriggerOptions): ExecutionTrigger {
  const resourcePart = /^[a-z0-9][a-z0-9-]{0,62}$/;
  if (![options.projectId, options.region, options.jobName, options.containerName ?? 'worker'].every((value) => resourcePart.test(value)) || options.projectNumber && !/^\d{1,30}$/.test(options.projectNumber)) throw new CloudRunTriggerError('Cloud Run configuration is incomplete');
  const projects = new Set([options.projectId, ...(options.projectNumber ? [options.projectNumber] : [])]);
  const parent = `projects/${options.projectId}/locations/${options.region}/jobs/${options.jobName}`;
  const request = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const getToken = options.getAccessToken ?? (options.federation ? createVercelGoogleTokenProvider(options.federation) : googleTokenProvider(options.credentials));
  const next = (executionRef: string, delay = options.monitorDelayMs ?? 30_000) => ({ executionRef, nextCheckAt: new Date(now().getTime() + delay).toISOString() });
  const validateRef = (ref: string): 'execution' | 'operation' | 'uncertain' => {
    if (/^uncertain:[A-Za-z0-9_-]{1,160}$/.test(ref)) return 'uncertain';
    const match = ref.match(/^projects\/([a-z0-9-]+)\/locations\/([a-z0-9-]+)\/(?:(?:jobs\/([a-z0-9-]+)\/executions\/([A-Za-z0-9_-]+))|(?:operations\/([A-Za-z0-9_-]+)))$/);
    if (!match || !projects.has(match[1]) || match[2] !== options.region || match[3] && match[3] !== options.jobName) throw new CloudRunTriggerError('Cloud execution reference is invalid');
    return match[5] ? 'operation' : 'execution';
  };
  async function call(path: string, body?: unknown): Promise<Response> {
    let token: string;
    try { token = await getToken(); if (!token || /[\r\n]/.test(token)) throw new Error(); }
    catch { throw new CloudRunTriggerError('Cloud execution credentials are unavailable', 'authorization'); }
    try {
      return await request(`https://run.googleapis.com/v2/${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
      });
    } catch { throw new CloudRunTriggerError('Cloud execution status is unavailable'); }
  }
  async function monitor(ref: string): Promise<{ ref: string; terminal: boolean }> {
    const kind = validateRef(ref);
    if (kind === 'uncertain') throw new CloudRunTriggerError('Cloud execution reference is invalid');
    const status = await responseJson(await call(ref));
    if (status.name !== ref) throw new CloudRunTriggerError('Cloud execution status is unavailable');
    if (kind === 'operation') {
      const executionRef = status.response?.name ?? status.metadata?.name;
      if (executionRef && validateRef(executionRef) === 'execution') return monitor(executionRef);
      return { ref, terminal: status.done === true };
    }
    const completed = status.conditions?.some((condition) => condition.type === 'Completed' && ['CONDITION_SUCCEEDED', 'CONDITION_FAILED'].includes(condition.state ?? '')) ?? false;
    return { ref, terminal: Boolean(status.completionTime || completed) };
  }
  async function lookupUncertain(ref: string, id: string, ownerId: string): Promise<string | null> {
    const nonce = ref.slice('uncertain:'.length);
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const result = await responseJson(await call(`${parent}/executions?${query}`));
      if (result.executions && !Array.isArray(result.executions)) throw new CloudRunTriggerError('Cloud execution status is unavailable');
      for (const execution of result.executions ?? []) {
        const entries = execution.template?.containers?.flatMap((container) => container.env ?? []) ?? [];
        const value = (name: string) => entries.find((entry) => entry.name === name)?.value;
        if (value('DISPATCH_ID') === nonce && value('JOB_ID') === id && value('OWNER_ID') === ownerId && execution.name) { validateRef(execution.name); return execution.name; }
      }
      pageToken = result.nextPageToken;
      if (!pageToken) break;
    }
    // Absence from a bounded listing is not proof that a timed-out run failed.
    return null;
  }
  async function start(action: 'process' | 'reconcile' | 'preflight', id: string, ownerId: string): Promise<{ executionRef?: string; nextCheckAt: string }> {
    const nonce = (options.id ?? randomUUID)();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(nonce)) throw new CloudRunTriggerError('Cloud dispatch identifier is invalid');
    const uncertain = `uncertain:${nonce}`;
    let response: Response;
    try {
      response = await call(`${parent}:run`, { overrides: { taskCount: 1, containerOverrides: [{ name: options.containerName ?? 'worker', env: [{ name: 'MODE', value: action }, { name: 'JOB_ID', value: id }, { name: 'OWNER_ID', value: ownerId }, { name: 'DISPATCH_ID', value: nonce }] }] } });
    } catch (error) { if (error instanceof CloudRunTriggerError && error.kind === 'authorization') throw error; return next(uncertain, 60_000); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 500 || response.status === 408) return next(uncertain, 60_000);
      throw new CloudRunTriggerError('Cloud execution request was not accepted');
    }
    let ref: string;
    try {
      const accepted = await responseJson(response);
      ref = accepted.response?.name ?? accepted.metadata?.name ?? accepted.name ?? '';
      validateRef(ref);
    } catch { return next(uncertain, 60_000); }
    try { return next((await monitor(ref)).ref); }
    catch { return next(ref); } // Preserve acceptance even if immediate monitoring failed.
  }
  return async (action, id, ownerId, existingExecutionRef) => {
    if (!['process', 'reconcile', 'preflight'].includes(action) || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || !ownerId || ownerId.length > 512 || /[\r\n\0]/.test(ownerId)) throw new CloudRunTriggerError('Cloud dispatch request is invalid');
    if (!existingExecutionRef) return start(action, id, ownerId);
    const kind = validateRef(existingExecutionRef);
    const ref = kind === 'uncertain' ? await lookupUncertain(existingExecutionRef, id, ownerId) : existingExecutionRef;
    if (!ref) return next(existingExecutionRef, 60_000);
    const status = await monitor(ref);
    if (!status.terminal) return next(status.ref);
    return start(action === 'preflight' ? 'preflight' : 'reconcile', id, ownerId);
  };
}

export function cloudRunTriggerFromEnvironment(source: Record<string, string | undefined>): ExecutionTrigger | undefined {
  const projectId = source.GOOGLE_CLOUD_PROJECT ?? source.GCP_PROJECT_ID;
  const region = source.CLOUD_RUN_REGION;
  const jobName = source.CLOUD_RUN_JOB;
  if (![projectId, region, jobName].some(Boolean)) return undefined;
  if (!projectId || !region || !jobName) throw new CloudRunTriggerError('Cloud Run configuration is incomplete');
  let federation: VercelGoogleFederation | undefined;
  const federationParts = [source.GCP_SERVICE_ACCOUNT_EMAIL, source.GCP_WORKLOAD_IDENTITY_POOL_ID, source.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID];
  if (federationParts.some(Boolean)) {
    const projectNumber = source.GCP_PROJECT_NUMBER ?? source.GOOGLE_CLOUD_PROJECT_NUMBER;
    if (!projectNumber || !federationParts.every(Boolean)) throw new CloudRunTriggerError('Workload identity federation configuration is incomplete');
    federation = { projectNumber, serviceAccountEmail: source.GCP_SERVICE_ACCOUNT_EMAIL!, poolId: source.GCP_WORKLOAD_IDENTITY_POOL_ID!, providerId: source.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID!, audience: source.GCP_AUDIENCE };
  }
  let credentials: GoogleCredentials | undefined;
  if (!federation && source.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(source.GOOGLE_SERVICE_ACCOUNT_JSON) as GoogleCredentials;
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string' || !parsed.client_email || !parsed.private_key) throw new Error();
      credentials = { client_email: parsed.client_email, private_key: parsed.private_key, ...(parsed.project_id ? { project_id: parsed.project_id } : {}), type: 'service_account' };
    } catch { throw new CloudRunTriggerError('Google service account configuration is invalid'); }
  }
  return createCloudRunTrigger({ projectId, projectNumber: source.GOOGLE_CLOUD_PROJECT_NUMBER ?? source.GCP_PROJECT_NUMBER, region, jobName, containerName: source.CLOUD_RUN_CONTAINER ?? 'worker', credentials, federation });
}
