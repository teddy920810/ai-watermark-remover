import { createHash } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ProcessingError } from './contracts';
import type { AttemptResult, ProcessingArtifact, ProcessingArtifactStore, ProcessingJob, ProcessingJobStore, ProcessingQuote, ProcessingQuoteStore } from './contracts';

export interface ConditionalJsonStore {
  get<T>(key: string): Promise<{ value: T; version: string } | null>;
  create(key: string, value: unknown): Promise<boolean>;
  update(key: string, version: string, value: unknown): Promise<boolean>;
  list(prefix: string, limit: number): Promise<string[]>;
}
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const idKey = (value: string) => encodeURIComponent(value);

/** R2 evaluates these conditions atomically at commit: https://developers.cloudflare.com/r2/reference/consistency/ */
export class S3ConditionalJsonStore implements ConditionalJsonStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}
  async get<T>(key: string): Promise<{ value: T; version: string } | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body || !response.ETag) throw new Error('Versioned object is missing body or ETag');
      return { value: JSON.parse(await response.Body.transformToString()) as T, version: response.ETag };
    } catch (error) { if (status(error) === 404) return null; throw error; }
  }
  async create(key: string, value: unknown): Promise<boolean> { return this.put(key, value, { IfNoneMatch: '*' }); }
  async update(key: string, version: string, value: unknown): Promise<boolean> { return this.put(key, value, { IfMatch: version }); }
  private async put(key: string, value: unknown, condition: { IfMatch?: string; IfNoneMatch?: string }): Promise<boolean> {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json', CacheControl: 'private, no-store', ...condition }));
      return true;
    } catch (error) { if (status(error) === 412) return false; throw error; }
  }
  async list(prefix: string, limit: number): Promise<string[]> {
    const keys: string[] = []; let token: string | undefined;
    do {
      const result = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: Math.min(1000, limit - keys.length), ContinuationToken: token }));
      keys.push(...(result.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []));
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token && keys.length < limit);
    return keys.slice(0, limit);
  }
}

export class R2ProcessingJobStore implements ProcessingJobStore {
  constructor(private readonly objects: ConditionalJsonStore) {}
  private key(id: string) { return `processing/jobs/${idKey(id)}.json`; }
  private ownerPrefix(ownerId: string) { return `processing/owners/${createHash('sha256').update(ownerId).digest('hex')}/`; }
  async create(job: ProcessingJob): Promise<boolean> {
    if (!await this.objects.create(this.key(job.id), job)) return false;
    const time = String(9_999_999_999_999 - Date.parse(job.createdAt)).padStart(13, '0');
    await this.objects.create(`${this.ownerPrefix(job.ownerId)}${time}-${idKey(job.id)}.json`, { jobId: job.id, ownerId: job.ownerId });
    return true;
  }
  async get(id: string) { const record = await this.objects.get<ProcessingJob>(this.key(id)); return record ? { job: record.value, version: record.version } : null; }
  async compareAndSwap(id: string, version: string, job: ProcessingJob): Promise<boolean> {
    if (job.id !== id) throw new ProcessingError('job_conflict', 'Task identity cannot change', 409);
    return this.objects.update(this.key(id), version, job);
  }
  async listForOwner(ownerId: string, limit = 20): Promise<ProcessingJob[]> {
    const keys = await this.objects.list(this.ownerPrefix(ownerId), limit);
    const jobs = await Promise.all(keys.map(async (key) => {
      const locator = await this.objects.get<{ jobId: string; ownerId: string }>(key);
      if (locator?.value.ownerId !== ownerId) return null;
      const job = await this.get(locator.value.jobId); return job?.job.ownerId === ownerId ? job.job : null;
    }));
    return jobs.filter((job): job is ProcessingJob => job !== null);
  }
  async recordAttemptResult(result: AttemptResult): Promise<void> { await this.objects.create(`processing/attempts/${idKey(result.jobId)}/${idKey(result.attemptId)}.json`, result); }
  async getAttemptResult(jobId: string, attemptId: string): Promise<AttemptResult | null> { return (await this.objects.get<AttemptResult>(`processing/attempts/${idKey(jobId)}/${idKey(attemptId)}.json`))?.value ?? null; }
}

async function immutableCreate<T>(objects: ConditionalJsonStore, key: string, value: T): Promise<void> {
  if (await objects.create(key, value)) return;
  const existing = await objects.get<T>(key);
  if (!existing || JSON.stringify(existing.value) !== JSON.stringify(value)) throw new ProcessingError('immutable_conflict', 'Sealed record cannot be overwritten', 409);
}
export class R2ProcessingArtifactStore implements ProcessingArtifactStore {
  constructor(private readonly objects: ConditionalJsonStore, private readonly verify: (artifact: ProcessingArtifact) => Promise<void>) {}
  async get(id: string): Promise<ProcessingArtifact | null> { return (await this.objects.get<ProcessingArtifact>(`processing/artifacts/${idKey(id)}.json`))?.value ?? null; }
  create(artifact: ProcessingArtifact): Promise<void> { return immutableCreate(this.objects, `processing/artifacts/${idKey(artifact.id)}.json`, artifact); }
  verifyStored(artifact: ProcessingArtifact): Promise<void> { return this.verify(artifact); }
}
export class R2ProcessingQuoteStore implements ProcessingQuoteStore {
  constructor(private readonly objects: ConditionalJsonStore) {}
  async get(id: string): Promise<ProcessingQuote | null> { return (await this.objects.get<ProcessingQuote>(`processing/quotes/${idKey(id)}.json`))?.value ?? null; }
  create(quote: ProcessingQuote): Promise<void> { return immutableCreate(this.objects, `processing/quotes/${idKey(quote.id)}.json`, quote); }
}
