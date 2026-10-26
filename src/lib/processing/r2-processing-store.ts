import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ProcessingError } from './contracts';
import type { AttemptResult, ProcessingArtifact, ProcessingArtifactStore, ProcessingJob, ProcessingJobStore, ProcessingQuote, ProcessingQuoteStore } from './contracts';

export interface ConditionalJsonStore {
  get<T>(key: string): Promise<{ value: T; version: string } | null>;
  create(key: string, value: unknown): Promise<boolean>;
  update(key: string, version: string, value: unknown): Promise<boolean>;
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
}

export class R2ProcessingJobStore implements ProcessingJobStore {
  constructor(private readonly objects: ConditionalJsonStore) {}
  private key(id: string) { return `processing/jobs/${idKey(id)}.json`; }
  create(job: ProcessingJob): Promise<boolean> { return this.objects.create(this.key(job.id), job); }
  async get(id: string) { const record = await this.objects.get<ProcessingJob>(this.key(id)); return record ? { job: record.value, version: record.version } : null; }
  async compareAndSwap(id: string, version: string, job: ProcessingJob): Promise<boolean> {
    if (job.id !== id) throw new ProcessingError('job_conflict', 'Task identity cannot change', 409);
    return this.objects.update(this.key(id), version, job);
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
