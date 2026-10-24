import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import { CloudRunTriggerError, cloudRunTriggerFromEnvironment, createCloudRunTrigger, createVercelGoogleTokenProvider } from './cloud-run-trigger';

vi.mock('@vercel/oidc', () => ({ getVercelOidcToken: vi.fn().mockResolvedValue('short-vercel-subject') }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

const job = 'projects/demo-project/locations/asia-east1/jobs/watermark-worker';
const operation = 'projects/demo-project/locations/asia-east1/operations/operation-1';
const execution = `${job}/executions/execution-1`;
const nextExecution = `${job}/executions/execution-2`;
const now = () => new Date('2026-10-24T00:00:00.000Z');
function trigger(request: ReturnType<typeof vi.fn>) {
  return createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', getAccessToken: vi.fn().mockResolvedValue('private-google-access'), fetchImpl: request as typeof fetch, now, id: () => 'dispatch-1' });
}

describe('Cloud Run execution trigger and recovery', () => {
  it('runs a single task with identifier overrides, then checks the accepted execution', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ name: operation, metadata: { name: execution } })).mockResolvedValueOnce(Response.json({ name: execution, runningCount: 1 }));
    await expect(trigger(request)('process', 'job-1', 'owner-1')).resolves.toEqual({ executionRef: execution, nextCheckAt: '2026-10-24T00:00:30.000Z' });
    expect(request.mock.calls[0][0]).toBe(`https://run.googleapis.com/v2/${job}:run`);
    const init = request.mock.calls[0][1];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer private-google-access', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ overrides: { taskCount: 1, containerOverrides: [{ name: 'worker', env: [{ name: 'MODE', value: 'process' }, { name: 'JOB_ID', value: 'job-1' }, { name: 'OWNER_ID', value: 'owner-1' }, { name: 'DISPATCH_ID', value: 'dispatch-1' }] }] } });
    expect(request.mock.calls[1][0]).toBe(`https://run.googleapis.com/v2/${execution}`);
  });
  it('only queries an existing active execution and never starts it again', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ name: execution, runningCount: 1 }));
    await expect(trigger(request)('process', 'job-1', 'owner-1', execution)).resolves.toMatchObject({ executionRef: execution });
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1].method).toBe('GET');
  });
  it('monitors an accepted long-running operation without assuming a task has started', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ name: operation, done: false }));
    await expect(trigger(request)('process', 'job-1', 'owner-1', operation)).resolves.toMatchObject({ executionRef: operation });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('starts reconciliation only after the stored execution is confirmed terminal', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ name: execution, completionTime: '2026-10-24T00:00:00Z', succeededCount: 1 }))
      .mockResolvedValueOnce(Response.json({ name: operation, metadata: { name: nextExecution } }))
      .mockResolvedValueOnce(Response.json({ name: nextExecution, runningCount: 1 }));
    await expect(trigger(request)('process', 'job-1', 'owner-1', execution)).resolves.toMatchObject({ executionRef: nextExecution });
    const posted = request.mock.calls.find(([, init]) => init.method === 'POST');
    expect(JSON.parse(posted![1].body).overrides.containerOverrides[0].env[0]).toEqual({ name: 'MODE', value: 'reconcile' });
  });
  it('does not start another execution when status lookup is temporarily unavailable', async () => {
    const request = vi.fn().mockResolvedValue(new Response('private upstream diagnostics', { status: 503 }));
    await expect(trigger(request)('process', 'job-1', 'owner-1', execution)).rejects.toThrow('Cloud execution status is unavailable');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('retains the accepted reference if its immediate monitoring request fails', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ name: operation, metadata: { name: execution } })).mockRejectedValueOnce(new Error('private upstream data'));
    await expect(trigger(request)('process', 'job-1', 'owner-1')).resolves.toMatchObject({ executionRef: execution });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('records an uncertain run nonce and searches for it instead of repeating a lost POST', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('run response lost'));
    await expect(trigger(request)('process', 'job-1', 'owner-1')).resolves.toMatchObject({ executionRef: 'uncertain:dispatch-1' });
    request.mockReset().mockResolvedValue(Response.json({ executions: [] }));
    await expect(trigger(request)('process', 'job-1', 'owner-1', 'uncertain:dispatch-1')).resolves.toMatchObject({ executionRef: 'uncertain:dispatch-1' });
    expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('finds an uncertain execution by nonce plus owner and task binding', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ executions: [{ name: execution, template: { containers: [{ env: [{ name: 'DISPATCH_ID', value: 'dispatch-1' }, { name: 'JOB_ID', value: 'job-1' }, { name: 'OWNER_ID', value: 'owner-1' }] }] } }] })).mockResolvedValueOnce(Response.json({ name: execution, runningCount: 1 }));
    await expect(trigger(request)('process', 'job-1', 'owner-1', 'uncertain:dispatch-1')).resolves.toMatchObject({ executionRef: execution });
    expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('rejects untrusted resource paths before requesting Google credentials', async () => {
    const request = vi.fn();
    await expect(trigger(request)('process', 'job-1', 'owner-1', 'https://attacker.test/private')).rejects.toThrow('Cloud execution reference is invalid');
    expect(request).not.toHaveBeenCalled();
  });
  it('requires complete configuration and keeps all credential material private', () => {
    expect(cloudRunTriggerFromEnvironment({})).toBeUndefined();
    expect(() => cloudRunTriggerFromEnvironment({ CLOUD_RUN_JOB: 'worker' })).toThrow('Cloud Run configuration is incomplete');
    expect(() => cloudRunTriggerFromEnvironment({ GOOGLE_CLOUD_PROJECT: 'demo-project', CLOUD_RUN_REGION: 'asia-east1', CLOUD_RUN_JOB: 'worker', GOOGLE_SERVICE_ACCOUNT_JSON: '{private-secret}' })).toThrow('Google service account configuration is invalid');
  });
  it('keeps a credential failure retryable instead of recording a run that was never sent', async () => {
    const request = vi.fn();
    const dispatch = createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', fetchImpl: request as typeof fetch, getAccessToken: vi.fn().mockRejectedValue(new Error('private credential detail')) });
    await expect(dispatch('process', 'job-1', 'owner-1')).rejects.toThrow('Cloud execution credentials are unavailable');
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves a safe supplier failure phase through dispatch without sending a run', async () => {
    const request = vi.fn();
    const dispatch = createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', fetchImpl: request as typeof fetch, getAccessToken: vi.fn().mockRejectedValue(new CloudRunTriggerError('private detail', 'authorization', 'oidc_exchange', 401)) });
    await expect(dispatch('preflight', 'upload-1', 'owner-1')).rejects.toMatchObject({ kind: 'authorization', phase: 'oidc_exchange', status: 401 });
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps unclassified credential failures retryable even when their original kind is other', async () => {
    const request = vi.fn();
    const dispatch = createCloudRunTrigger({ projectId: 'demo-project', region: 'asia-east1', jobName: 'watermark-worker', fetchImpl: request as typeof fetch, getAccessToken: vi.fn().mockRejectedValue(new CloudRunTriggerError('private detail')) });
    await expect(dispatch('preflight', 'upload-1', 'owner-1')).rejects.toMatchObject({ kind: 'authorization', message: 'Cloud execution credentials are unavailable' });
    expect(request).not.toHaveBeenCalled();
  });
  it('labels a rejected Cloud Run request with only its phase and HTTP status', async () => {
    const request = vi.fn().mockResolvedValue(new Response('private upstream data', { status: 403 }));
    await expect(trigger(request)('preflight', 'upload-1', 'owner-1')).rejects.toMatchObject({ phase: 'cloud_run_http', status: 403 });
  });
  it.each([
    [new Error('Failed to exchange token: private upstream body'), 'oidc_exchange', undefined, 'Error'],
    [Object.assign(new Error('private refresh detail'), { name: 'VercelOidcTokenError' }), 'oidc_unavailable', undefined, undefined],
    [{ config: { url: 'https://sts.googleapis.com/v1/token' }, response: { status: 400, data: { error: 'invalid_grant', error_description: 'private token' } } }, 'google_sts', 400, 'invalid_grant'],
    [{ response: { config: { url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/vercel@demo-project.iam.gserviceaccount.com:generateAccessToken' }, status: 403, data: { error: { status: 'PERMISSION_DENIED', message: 'private policy' } } } }, 'google_impersonation', 403, 'PERMISSION_DENIED'],
    [{ config: { url: 'https://sts.googleapis.com.attacker.test/v1/token' }, response: { status: 'private URL', data: { error: 'private token' } } }, 'google_token_unknown', undefined, undefined],
    [new TypeError('private runtime detail'), 'google_token_unknown', undefined, 'TypeError'],
  ])('classifies token failures into fixed safe diagnostic fields', async (failure, phase, status, reason) => {
    vi.spyOn(ExternalAccountClient, 'fromJSON').mockReturnValue({ getAccessToken: vi.fn().mockRejectedValue(failure) } as unknown as ReturnType<typeof ExternalAccountClient.fromJSON>);
    const provider = createVercelGoogleTokenProvider({ projectNumber: '1234567890', serviceAccountEmail: 'vercel@demo-project.iam.gserviceaccount.com', poolId: 'vercel', providerId: 'vercel' });
    await expect(provider()).rejects.toMatchObject({ phase, status, reason });
  });
  it('preserves the official custom-audience federation object and only obtains short-lived tokens on demand', async () => {
    const access = vi.fn().mockResolvedValue({ token: 'short-google-access' });
    const factory = vi.spyOn(ExternalAccountClient, 'fromJSON').mockReturnValue({ getAccessToken: access } as unknown as ReturnType<typeof ExternalAccountClient.fromJSON>);
    const provider = createVercelGoogleTokenProvider({ projectNumber: '1234567890', serviceAccountEmail: 'vercel@demo-project.iam.gserviceaccount.com', poolId: 'vercel', providerId: 'vercel' });
    const audience = 'https://iam.googleapis.com/projects/1234567890/locations/global/workloadIdentityPools/vercel/providers/vercel';
    expect(factory).toHaveBeenCalledWith({ type: 'external_account', audience, subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_url: 'https://sts.googleapis.com/v1/token', service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/vercel@demo-project.iam.gserviceaccount.com:generateAccessToken', subject_token_supplier: { getSubjectToken: expect.any(Function) } });
    expect(access).not.toHaveBeenCalled(); expect(getVercelOidcToken).not.toHaveBeenCalled();
    const configuration = factory.mock.calls[0][0] as { subject_token_supplier: { getSubjectToken: (context?: unknown) => Promise<string> } };
    await configuration.subject_token_supplier.getSubjectToken({ audience: 'incorrect-supplier-context' });
    expect(getVercelOidcToken).toHaveBeenCalledWith({ audience });
    await expect(provider()).resolves.toBe('short-google-access');
  });
  it('uses complete Vercel federation settings ahead of a legacy private-key configuration', () => {
    const factory = vi.spyOn(ExternalAccountClient, 'fromJSON').mockReturnValue({ getAccessToken: vi.fn() } as unknown as ReturnType<typeof ExternalAccountClient.fromJSON>);
    expect(cloudRunTriggerFromEnvironment({ GCP_PROJECT_ID: 'demo-project', GCP_PROJECT_NUMBER: '1234567890', CLOUD_RUN_REGION: 'asia-east1', CLOUD_RUN_JOB: 'worker', GCP_SERVICE_ACCOUNT_EMAIL: 'vercel@demo-project.iam.gserviceaccount.com', GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel', GOOGLE_SERVICE_ACCOUNT_JSON: '{unused-long-lived-secret}' })).toBeTypeOf('function');
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it('fails closed on incomplete federation instead of silently switching to another credential source', () => {
    expect(() => cloudRunTriggerFromEnvironment({ GOOGLE_CLOUD_PROJECT: 'demo-project', CLOUD_RUN_REGION: 'asia-east1', CLOUD_RUN_JOB: 'worker', GCP_SERVICE_ACCOUNT_EMAIL: 'vercel@demo-project.iam.gserviceaccount.com' })).toThrow('Workload identity federation configuration is incomplete');
  });
});
