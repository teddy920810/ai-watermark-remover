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
const failurePhases = ['oidc_unavailable', 'oidc_exchange', 'google_sts', 'google_impersonation', 'google_token_unknown', 'cloud_run_http'] as const;
const failureReasons = ['invalid_grant', 'invalid_target', 'invalid_request', 'invalid_scope', 'unauthorized_client', 'access_denied', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'Error', 'TypeError'] as const;
type FailurePhase = typeof failurePhases[number];
type FailureReason = typeof failureReasons[number];
export class CloudRunTriggerError extends Error {
  constructor(message: string, readonly kind: 'authorization' | 'other' = 'other', readonly phase?: FailurePhase, readonly status?: number, readonly reason?: FailureReason, readonly acceptance?: 'not-accepted') { super(message); this.name = 'CloudRunTriggerError'; }
}
const numericHttpStatus = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
const errorRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Persist only fixed diagnostic vocabulary, never upstream messages or config. */
export function cloudRunDispatchDiagnostic(error: unknown): string {
  if (!(error instanceof CloudRunTriggerError) || !failurePhases.includes(error.phase!)) return 'dispatch_unavailable';
  const status = numericHttpStatus(error.status);
  const reason = failureReasons.includes(error.reason!) ? error.reason : undefined;
  return `dispatch_${error.phase}${status ? `_${status}` : ''}${reason ? `_${reason}` : ''}`;
}
function tokenFailure(error: unknown, serviceAccountEmail?: string): CloudRunTriggerError {
  const failure = errorRecord(error); const response = errorRecord(failure.response); const data = errorRecord(response.data);
  const endpoint = errorRecord(failure.config).url ?? errorRecord(response.config).url;
  const url = endpoint instanceof URL ? endpoint.href : endpoint;
  let phase: FailurePhase = 'google_token_unknown';
  // Match exact SDK endpoints; arbitrary URLs and error codes never become diagnostics.
  if (url === 'https://sts.googleapis.com/v1/token') phase = 'google_sts';
  else if (serviceAccountEmail && url === `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`) phase = 'google_impersonation';
  // Fixed signatures from @vercel/oidc 3.8.5; no message contents are retained.
  // https://vercel.com/docs/oidc/gcp#custom-audience
  else if (error instanceof Error && error.message.startsWith('Failed to exchange token:')) phase = 'oidc_exchange';
  else if (error instanceof Error && (['VercelOidcTokenError', 'AccessTokenMissingError', 'RefreshAccessTokenFailedError'].includes(error.name) || error.message === "The 'x-vercel-oidc-token' header is missing from the request.")) phase = 'oidc_unavailable';
  const code = typeof data.error === 'string' ? data.error : errorRecord(data.error).status;
  const reason = failureReasons.includes(code as FailureReason) ? code as FailureReason : error instanceof Error && ['Error', 'TypeError'].includes(error.name) ? error.name as FailureReason : undefined;
  return new CloudRunTriggerError('Cloud execution credentials are unavailable', 'authorization', phase, numericHttpStatus(response.status), reason);
}

export function createVercelGoogleTokenProvider(options: VercelGoogleFederation): () => Promise<string> {
  const GCP_PROJECT_NUMBER = options.projectNumber;
  const GCP_SERVICE_ACCOUNT_EMAIL = options.serviceAccountEmail;
  const GCP_WORKLOAD_IDENTITY_POOL_ID = options.poolId;
  const GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = options.providerId;
  if (!/^\d{1,30}$/.test(GCP_PROJECT_NUMBER) || !/^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(GCP_SERVICE_ACCOUNT_EMAIL) || ![GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID].every((value) => /^[a-z0-9][a-z0-9_-]{0,127}$/.test(value))) throw new CloudRunTriggerError('Workload identity federation configuration is invalid');

  // Preserve Vercel's custom-audience supplier and ExternalAccountClient shape.
  // https://vercel.com/docs/oidc/gcp (updated 2026-09-01)
  // The supplier runs inside the request, never at module load, and receives a
  // fresh short-lived Vercel subject token when Google's client needs one.
  const GCP_AUDIENCE = `https://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
  // Approved deviation from Vercel's example: STS requires a full resource name,
  // while the Vercel subject token's custom audience remains the HTTPS URL.
  // https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
  const GCP_STS_AUDIENCE = `//iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
  if (options.audience && options.audience !== GCP_AUDIENCE) throw new CloudRunTriggerError('Workload identity federation audience does not match its provider');
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: GCP_STS_AUDIENCE,
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
    } catch (error) { throw tokenFailure(error, GCP_SERVICE_ACCOUNT_EMAIL); }
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
    } catch (error) { throw tokenFailure(error); }
  };
}
function object(value: unknown): CloudState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudRunTriggerError('Cloud execution status is unavailable');
  return value as CloudState;
}
async function responseJson(response: Response): Promise<CloudState> {
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new CloudRunTriggerError('Cloud execution status is unavailable', 'other', 'cloud_run_http', response.status); }
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
    catch (error) { if (error instanceof CloudRunTriggerError) throw new CloudRunTriggerError('Cloud execution credentials are unavailable', 'authorization', error.phase, error.status, error.reason); throw tokenFailure(error); }
    try {
      return await request(`https://run.googleapis.com/v2/${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
      });
    } catch { throw new CloudRunTriggerError('Cloud execution status is unavailable', 'other', 'cloud_run_http'); }
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
  async function start(action: 'process' | 'reconcile' | 'preflight', id: string, ownerId: string, dispatchId?: string): Promise<{ executionRef?: string; nextCheckAt: string }> {
    const nonce = dispatchId ?? (options.id ?? randomUUID)();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(nonce)) throw new CloudRunTriggerError('Cloud dispatch identifier is invalid');
    const uncertain = `uncertain:${nonce}`;
    let response: Response;
    try {
      response = await call(`${parent}:run`, { overrides: { taskCount: 1, containerOverrides: [{ name: options.containerName ?? 'worker', env: [{ name: 'MODE', value: action }, { name: 'JOB_ID', value: id }, { name: 'OWNER_ID', value: ownerId }, { name: 'DISPATCH_ID', value: nonce }] }] } });
    } catch (error) {
      // Only this new-run call proves a credential error happened before POST.
      // The same error during monitoring says nothing about prior acceptance.
      if (error instanceof CloudRunTriggerError && error.kind === 'authorization') throw new CloudRunTriggerError(error.message, error.kind, error.phase, error.status, error.reason, 'not-accepted');
      return next(uncertain, 60_000);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 500 || response.status === 408) return next(uncertain, 60_000);
      throw new CloudRunTriggerError('Cloud execution request was not accepted', 'other', 'cloud_run_http', response.status, undefined, response.status >= 400 && response.status < 500 ? 'not-accepted' : undefined);
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
  return async (action, id, ownerId, existingExecutionRef, dispatchId) => {
    if (!['process', 'reconcile', 'preflight'].includes(action) || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || !ownerId || ownerId.length > 512 || /[\r\n\0]/.test(ownerId)) throw new CloudRunTriggerError('Cloud dispatch request is invalid');
    if (dispatchId !== undefined && !/^[A-Za-z0-9_-]{1,160}$/.test(dispatchId)) throw new CloudRunTriggerError('Cloud dispatch identifier is invalid');
    if (!existingExecutionRef) return start(action, id, ownerId, dispatchId);
    const kind = validateRef(existingExecutionRef);
    const ref = kind === 'uncertain' ? await lookupUncertain(existingExecutionRef, id, ownerId) : existingExecutionRef;
    if (!ref) return next(existingExecutionRef, 60_000);
    const status = await monitor(ref);
    if (!status.terminal) return next(status.ref);
    // The caller journals a fresh nonce before each subsequent run. Monitoring
    // must not open a crash window by starting an unjournaled reconciliation.
    if (dispatchId !== undefined) return { ...next(status.ref), terminal: true };
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
