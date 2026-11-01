import { describe, expect, it } from 'vitest';
import { SensitiveRetention } from './sensitive-retention';
import type { Admission, ProcessingJob } from './contracts';

const now = new Date('2026-11-01T00:00:00Z');
function fixture() {
  const clock = { value: now };
  const values = new Map<string, { value: unknown; version: string }>();
  const put = (key: string, value: unknown) => values.set(key, { value: structuredClone(value), version: '1' });
  const artifact = (id: string, role: string) => ({ id, ownerId: 'owner', role, key: `processing/${role === 'result' ? 'results' : 'inputs'}/owner/${id}.jpg`, sealed: true, sha256: 'abc', metadata: { kind: 'image', contentType: 'image/jpeg', width: 2, height: 2, byteSize: 20 }, createdAt: '2026-10-20T00:00:00Z', expiresAt: '2026-10-21T00:00:00Z' });
  const result = { ...artifact('result', 'result'), parentArtifactId: 'input', providerSessionId: 'private-session' };
  const job = { id: 'job', ownerId: 'owner', status: 'READY', operation: 'image-watermark', inputArtifactId: 'input', resultArtifactId: 'result', quote: { id: 'quote', ownerId: 'owner', amount: 1, unit: 'freeUses', fingerprint: 'original-fingerprint' }, chargeStatus: 'settled', attempt: { id: 'attempt', checkpoint: { sessionId: 'private-session', providerJobId: 'keep-provider-id' } }, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' } as ProcessingJob;
  put('processing/jobs/job.json', job);
  put('processing/artifacts/input.json', artifact('input', 'source'));
  put('processing/artifacts/result.json', result);
  put('processing/provider-metadata/result.json', { mode: 'auto', sessionId: 'private-session', maskBase: 'private-mask', imageId: 'keep-image-id' });
  put('processing/provider-attempts/job/attempt.json', { artifact: result, providerMetadata: { mode: 'auto', sessionId: 'private-session', watermarkMask: 'private-mask' } });
  put('processing/attempts/job/attempt.json', { jobId: 'job', attemptId: 'attempt', artifact: result, receivedAt: '2026-10-21T00:00:00Z' });
  const writes: string[] = [];
  const admissions = new Map<string, Admission>([['job', { jobId: 'job', ownerId: 'owner', amount: 1, unit: 'freeUses', status: 'settled', idempotencyKey: 'original-key', requestHash: 'original-hash' }]]);
  const objects = {
    async list(prefix: string) { return [...values.keys()].filter(key => key.startsWith(prefix)); },
    async get<T>(key: string) { return structuredClone(values.get(key) ?? null) as { value: T; version: string } | null; },
    async update(key: string, version: string, value: unknown) { const current = values.get(key); if (current?.version !== version) return false; writes.push(key); values.set(key, { value: structuredClone(value), version: String(Number(version) + 1) }); return true; },
  };
  const finance = { async getAdmission(id: string) { return admissions.get(id) ?? null; } };
  return { values, put, artifact, result, job, writes, admissions, objects, finance, clock, cleanup: () => new SensitiveRetention({ objects, finance, now: () => clock.value }) };
}
describe('expired sensitive recovery fields', () => {
  it('defaults to a read-only plan and requires the exact reviewed digest to apply', async () => {
    const f = fixture(); const plan = await f.cleanup().run();
    expect(plan.eligibleJobs).toBe(1); expect(plan.redactedRecords).toBe(0); expect(f.writes).toEqual([]);
    await expect(f.cleanup().run({ apply: true, expectedDigest: 'wrong' })).rejects.toThrow(/plan/i);
    expect(f.writes).toEqual([]);
    const applied = await f.cleanup().run({ apply: true, expectedDigest: plan.digest });
    expect(applied.redactedRecords).toBeGreaterThan(3);
    const records = JSON.stringify([...f.values]);
    expect(records).not.toContain('private-session'); expect(records).not.toContain('private-mask');
    expect(records).toContain('original-fingerprint'); expect(records).toContain('keep-provider-id'); expect(records).toContain('keep-image-id');
    expect(f.admissions.get('job')?.requestHash).toBe('original-hash');
    expect((await f.cleanup().run()).eligibleJobs).toBe(0);
  });
  it.each(['UNKNOWN', 'SAVING', 'SETTLING', 'SUBMITTING', 'REFUNDED', 'FAILED'])('protects %s even after a financial refund', async status => {
    const f = fixture(); f.put('processing/jobs/job.json', { ...f.job, status, chargeStatus: 'refunded' }); f.admissions.get('job')!.status = 'refunded';
    expect((await f.cleanup().run()).eligibleJobs).toBe(0); expect(f.writes).toEqual([]);
  });
  it('protects pending results, live leases and unexpired result sessions', async () => {
    for (const patch of [{ pendingResult: fixture().result }, { lease: { owner: 'worker', epoch: 1, expiresAt: '2026-11-02T00:00:00Z' } }]) {
      const f = fixture(); f.put('processing/jobs/job.json', { ...f.job, ...patch }); expect((await f.cleanup().run()).eligibleJobs).toBe(0);
    }
    const f = fixture(); f.put('processing/artifacts/result.json', { ...f.result, expiresAt: '2026-11-02T00:00:00Z' }); expect((await f.cleanup().run()).eligibleJobs).toBe(0);
  });
  it('protects a completed parent while its refinement child still needs recovery', async () => {
    const f = fixture(); f.put('processing/jobs/child.json', { ...f.job, id: 'child', parentJobId: 'job', inputArtifactId: 'result', resultArtifactId: undefined, status: 'UNKNOWN' });
    expect((await f.cleanup().run()).eligibleJobs).toBe(0); expect(f.writes).toEqual([]);
  });
  it('protects an orphaned refinement, a foreign media key and a still-valid explicit job window', async () => {
    const orphan = fixture(); orphan.put('processing/jobs/job.json', { ...orphan.job, parentJobId: 'missing-parent' });
    expect((await orphan.cleanup().run()).eligibleJobs).toBe(0);
    const foreign = fixture(); foreign.put('processing/artifacts/result.json', { ...foreign.result, key: 'processing/results/another/result.jpg' });
    expect((await foreign.cleanup().run()).eligibleJobs).toBe(0);
    const validWindow = fixture(); validWindow.put('processing/jobs/job.json', { ...validWindow.job, expiresAt: '2026-11-02T00:00:00Z' });
    expect((await validWindow.cleanup().run()).eligibleJobs).toBe(0);
  });
  it('rejects cross-owner receipts and any changed record after dry-run', async () => {
    const f = fixture(); const plan = await f.cleanup().run();
    f.put('processing/provider-attempts/job/attempt.json', { artifact: { ...f.result, ownerId: 'another' } });
    expect((await f.cleanup().run()).eligibleJobs).toBe(0);
    await expect(f.cleanup().run({ apply: true, expectedDigest: plan.digest })).rejects.toThrow(/plan/i); expect(f.writes).toEqual([]);
  });
  it('retains prediction identifiers and handles Replicate result receipt paths without claiming session data exists', async () => {
    const f = fixture();
    f.put('processing/provider-attempts/job/attempt/predictions.json', { id: 'prediction-id', ownerId: 'owner', inputArtifactId: 'input' });
    f.put('processing/provider-attempts/job/attempt/results.json', f.result);
    const plan = await f.cleanup().run(); expect(plan.eligibleJobs).toBe(1);
    await f.cleanup().run({ apply: true, expectedDigest: plan.digest });
    expect(f.values.get('processing/provider-attempts/job/attempt/predictions.json')?.value).toMatchObject({ id: 'prediction-id' });
    expect(f.values.get('processing/provider-attempts/job/attempt/results.json')?.value).not.toHaveProperty('providerSessionId');
  });
  it('stops on a CAS conflict and resumes idempotently only after the maintenance lease expires', async () => {
    const f = fixture(); const update = f.objects.update; let conflict = true;
    f.objects.update = async (key, version, value) => {
      if (key === 'processing/provider-metadata/result.json' && conflict) { conflict = false; return false; }
      return update(key, version, value);
    };
    const plan = await f.cleanup().run();
    await expect(f.cleanup().run({ apply: true, expectedDigest: plan.digest })).rejects.toThrow(/conflict/i);
    expect((await f.cleanup().run()).eligibleJobs).toBe(0);
    f.clock.value = new Date(now.getTime() + 600_000);
    const resumed = await f.cleanup().run(); expect(resumed.eligibleJobs).toBe(1);
    await f.cleanup().run({ apply: true, expectedDigest: resumed.digest });
    expect(JSON.stringify([...f.values])).not.toContain('private-session');
    expect(f.admissions.get('job')?.status).toBe('settled');
  });
});
