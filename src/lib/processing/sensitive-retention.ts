import { createHash, randomUUID } from 'node:crypto';
import type { ProcessingArtifact, ProcessingFinancialStore, ProcessingJob } from './contracts';

export interface RetentionObjects {
  list(prefix: string): Promise<string[]>;
  get<T>(key: string): Promise<{ value: T; version: string } | null>;
  update(key: string, version: string, value: unknown): Promise<boolean>;
}
interface Options { objects: RetentionObjects; finance: Pick<ProcessingFinancialStore, 'getAdmission'>; now?: () => Date }
interface RunOptions { apply?: boolean; expectedDigest?: string }
type RecordValue = { value: unknown; version: string };
type JobRecord = { key: string; value: ProcessingJob; version: string };
const graceMs = 86_400_000;
const leaseMs = 300_000;
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const sensitive = new Set(['session', 'sessionId', 'session_id', 'providerSessionId', 'provider_session_id', 'maskBase', 'mask_base', 'watermarkMask', 'watermark_mask', 'maskBrush', 'mask_brush']);
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.has(key)).map(([key, child]) => [key, redact(child)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const artifactIds = (job: ProcessingJob) => [job.inputArtifactId, job.maskArtifactId, job.resultArtifactId, job.pendingResult?.id].filter((id): id is string => Boolean(id));
function safeId(id: string): string { if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('Retention inventory identity is invalid'); return id; }
export class SensitiveRetention {
  constructor(private readonly options: Options) {}
  async run(options: RunOptions = {}) {
    const { objects, finance } = this.options;
    const now = () => (this.options.now?.() ?? new Date()).getTime();
    const cutoff = now() - graceMs;
    const expired = (date?: string) => Boolean(date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= cutoff);
    const jobs: JobRecord[] = [];
    for (const key of await objects.list('processing/jobs/')) {
      const record = await objects.get<ProcessingJob>(key);
      if (!record || key !== `processing/jobs/${safeId(record.value.id)}.json` || !record.value.ownerId) throw new Error('Retention job inventory changed or is invalid');
      jobs.push({ key, ...record });
    }
    const remaining = new Set(jobs);
    const plans: Array<{ jobs: JobRecord[]; changes: Array<{ key: string; before: RecordValue; after: unknown }> }> = [];
    while (remaining.size) {
      const group = [remaining.values().next().value!]; remaining.delete(group[0]);
      const ids = new Set(artifactIds(group[0].value)); const jobIds = new Set([group[0].value.id]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const candidate of remaining) {
          if (jobIds.has(candidate.value.parentJobId ?? '') || group.some(j => j.value.parentJobId === candidate.value.id) || artifactIds(candidate.value).some(id => ids.has(id))) {
            group.push(candidate); remaining.delete(candidate); jobIds.add(candidate.value.id); artifactIds(candidate.value).forEach(id => ids.add(id)); expanded = true;
          }
        }
      }
      let eligible = true;
      const records = new Map<string, RecordValue>();
      for (const record of group) {
        const job = record.value;
        const admission = await finance.getAdmission(job.id);
        if (!['READY', 'EXPIRED'].includes(job.status) || job.pendingResult || !job.resultArtifactId || !expired(job.updatedAt)
          || job.expiresAt !== undefined && !expired(job.expiresAt)
          || job.parentJobId && !group.some(parent => parent.value.id === job.parentJobId)
          || job.lease && (!Number.isFinite(Date.parse(job.lease.expiresAt)) || Date.parse(job.lease.expiresAt) > now())
          || !admission || !['settled', 'refunded'].includes(admission.status) || admission.status !== job.chargeStatus
          || admission.ownerId !== job.ownerId || admission.amount !== job.quote.amount || admission.unit !== job.quote.unit || job.quote.ownerId !== job.ownerId) { eligible = false; break; }
        records.set(record.key, record);
      }
      if (!eligible) continue;
      const ownerId = group[0].value.ownerId;
      if (group.some(j => j.value.ownerId !== ownerId)) continue;
      const validArtifact = (artifact: ProcessingArtifact) => {
        if (!artifact || !ids.has(artifact.id) || artifact.ownerId !== ownerId || !expired(artifact.expiresAt)) return false;
        const extension = extensions[artifact.metadata?.contentType];
        const prefix = { source: 'inputs', mask: 'masks', result: 'results' }[artifact.role];
        if (!extension || !prefix || artifact.key !== `processing/${prefix}/${encodeURIComponent(ownerId)}/${artifact.id}.${extension}`) return false;
        if (artifact.role === 'result' && !group.some(job => job.value.resultArtifactId === artifact.id)) return false;
        return !artifact.parentArtifactId || ids.has(artifact.parentArtifactId);
      };
      for (const id of ids) {
        const key = `processing/artifacts/${safeId(id)}.json`;
        const record = await objects.get<ProcessingArtifact>(key);
        if (!record || !validArtifact(record.value)) { eligible = false; break; }
        records.set(key, record);
        const metadataKey = `processing/provider-metadata/${id}.json`;
        const metadata = await objects.get(metadataKey);
        if (metadata) records.set(metadataKey, metadata);
      }
      if (!eligible) continue;
      for (const { value: job } of group) {
        for (const prefix of ['processing/attempts/', 'processing/provider-attempts/', 'processing/mock-attempts/']) {
          for (const key of await objects.list(`${prefix}${job.id}/`)) {
            const record = await objects.get<Record<string, unknown>>(key);
            if (!record) throw new Error('Retention receipt inventory changed');
            const value = record.value;
            if (key.endsWith('/predictions.json')) {
              if (value.ownerId !== job.ownerId || value.inputArtifactId !== job.inputArtifactId) { eligible = false; break; }
              records.set(key, record); continue;
            }
            const artifact = (value.artifact ?? value) as ProcessingArtifact;
            if (!validArtifact(artifact) || artifact.role !== 'result' || artifact.parentArtifactId !== job.inputArtifactId
              || value.jobId !== undefined && value.jobId !== job.id) { eligible = false; break; }
            records.set(key, record);
          }
          if (!eligible) break;
        }
        if (!eligible) break;
      }
      if (!eligible) continue;
      const changes = [...records].map(([key, before]) => ({ key, before, after: redact(before.value) })).filter(change => hash(change.before.value) !== hash(change.after));
      if (changes.length) plans.push({ jobs: group, changes });
    }
    // Hashes/ETags identify the exact reviewed plan without logging private JSON.
    const digest = hash(plans.map(plan => ({ jobs: plan.jobs.map(j => [j.key, j.version]), changes: plan.changes.map(c => [c.key, c.before.version, hash(c.after)]) })));
    const eligibleJobs = plans.reduce((n, plan) => n + plan.jobs.length, 0);
    let redactedRecords = 0;
    if (options.apply) {
      if (!options.expectedDigest || options.expectedDigest !== digest) throw new Error('Retention plan changed; review a fresh dry-run plan');
      for (const plan of plans) {
        const deadline = now() + leaseMs; const owner = `retention-${randomUUID()}`;
        const locked = new Map<string, { job: ProcessingJob; version: string }>();
        for (const record of plan.jobs) {
          const job = { ...record.value, lease: { owner, epoch: (record.value.lease?.epoch ?? 0) + 1, expiresAt: new Date(deadline).toISOString() } };
          if (!await objects.update(record.key, record.version, job)) throw new Error('Retention lease conflict; restart from dry-run');
          const fresh = await objects.get<ProcessingJob>(record.key);
          if (!fresh || fresh.value.lease?.owner !== owner) throw new Error('Retention lease was lost');
          locked.set(record.key, { job: fresh.value, version: fresh.version });
        }
        for (const change of plan.changes.filter(c => !locked.has(c.key))) {
          if (now() >= deadline || !await objects.update(change.key, change.before.version, change.after)) throw new Error('Retention record conflict; restart from dry-run after the lease expires');
          redactedRecords++;
        }
        for (const [key, record] of locked) {
          const job = redact(record.job) as ProcessingJob;
          job.lease = { ...record.job.lease!, expiresAt: new Date(now()).toISOString() };
          if (now() >= deadline || !await objects.update(key, record.version, job)) throw new Error('Retention completion conflict; restart from dry-run');
          redactedRecords++;
        }
      }
    }
    return { inspectedJobs: jobs.length, eligibleJobs, redactedRecords, skippedJobs: jobs.length - eligibleJobs, digest, groups: plans.length };
  }
}
