import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ProcessingArtifact, ProcessingJob, ProcessingOperation } from '../processing/contracts';
import { MockWatermarkProvider } from './mock-provider';
import { createWatermarkProvider } from './watermark-provider-factory';
import type { ProcessingProviderContext, ProviderOutcome, WatermarkProvider } from './watermark-provider';

function context(operation: ProcessingOperation): ProcessingProviderContext {
  const input: ProcessingArtifact = {
    id: 'input-1', ownerId: 'owner-1', key: 'private/source-1.jpg', role: 'source', sealed: true,
    sha256: 'hash', metadata: { kind: operation === 'video-watermark' ? 'video' : 'image', contentType: 'image/jpeg', byteSize: 12, width: 4, height: 2 },
    createdAt: '2026-10-25T00:00:00.000Z', expiresAt: '2026-10-26T00:00:00.000Z',
  };
  const job: ProcessingJob = {
    id: 'job-1', ownerId: input.ownerId, operation, status: 'SUBMITTING', inputArtifactId: input.id, chargeStatus: 'reserved',
    quote: { id: 'quote-1', ownerId: input.ownerId, operation, inputArtifactId: input.id, amount: 1, unit: 'processingCredits', priceVersion: 'v1', fingerprint: 'fingerprint', createdAt: input.createdAt, expiresAt: input.expiresAt },
    attempt: { id: 'attempt-1', startedAt: input.createdAt }, createdAt: input.createdAt, updatedAt: input.createdAt,
  };
  return { job, input, checkpoint: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn().mockResolvedValue(undefined) };
}

describe('canonical WatermarkProvider', () => {
  it.each(['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark'] as const)('replaces %s and legacy removal through one typed provider boundary', async (operation) => {
    const copyObject = vi.fn().mockResolvedValue(undefined);
    const current = context(operation);
    const outcome: ProviderOutcome = { status: 'completed', artifact: { ...current.input, id: 'result-1', role: 'result', parentArtifactId: current.input.id } };
    const operations = {
      submit: vi.fn<WatermarkProvider['submit']>().mockResolvedValue(outcome),
      poll: vi.fn<WatermarkProvider['poll']>().mockResolvedValue(outcome),
    };
    const provider: WatermarkProvider = createWatermarkProvider(new MockWatermarkProvider({ copyObject }), operations);

    expectTypeOf(provider.submit).parameter(0).toEqualTypeOf<ProcessingProviderContext>();
    expectTypeOf(provider.submit).returns.resolves.toEqualTypeOf<ProviderOutcome>();
    await expect(provider.submit(current)).resolves.toBe(outcome);
    await expect(provider.poll(current)).resolves.toBe(outcome);
    expect(operations.submit).toHaveBeenCalledExactlyOnceWith(current);
    expect(operations.poll).toHaveBeenCalledExactlyOnceWith(current);
    await expect(provider.remove({ jobId: 'legacy-job', inputKey: 'uploads/source.png' })).resolves.toEqual({ status: 'completed', resultKey: 'results/legacy-job.png' });
    expect(copyObject).toHaveBeenCalledExactlyOnceWith('uploads/source.png', 'results/legacy-job.png');
  });

  it('preserves receiver, context identity and uncertain errors without retrying or changing checkpoints', async () => {
    const current = context('video-watermark');
    const failure = new Error('charged response was lost');
    const legacy = { token: 'legacy', remove: vi.fn(async function (this: { token: string }) { expect(this.token).toBe('legacy'); return { status: 'completed' as const, resultKey: 'results/old.jpg' }; }) };
    const operations = {
      token: 'operations',
      submit: vi.fn(async function (this: { token: string }, supplied: ProcessingProviderContext): Promise<ProviderOutcome> {
        expect(this.token).toBe('operations'); expect(supplied).toBe(current);
        await supplied.checkpoint({ stage: 'submitting' });
        throw failure;
      }),
      poll: vi.fn<WatermarkProvider['poll']>().mockRejectedValue(failure),
    };
    const provider = createWatermarkProvider(legacy, operations);
    await expect(provider.remove({ jobId: 'legacy-job', inputKey: 'uploads/old.jpg' })).resolves.toMatchObject({ resultKey: 'results/old.jpg' });
    await expect(provider.submit(current)).rejects.toBe(failure);
    await expect(provider.poll(current)).rejects.toBe(failure);
    expect(operations.submit).toHaveBeenCalledTimes(1); expect(operations.poll).toHaveBeenCalledTimes(1);
    expect(current.checkpoint).toHaveBeenCalledExactlyOnceWith({ stage: 'submitting' });
    expect(current.heartbeat).not.toHaveBeenCalled();
  });
});
