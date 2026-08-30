import sharp from 'sharp';
import { z } from 'zod';
import type { ObjectRemovalProvider } from './object-removal-provider';
import type { ProviderInput, ProviderResult } from './watermark-provider';

interface ObjectRemovalObjects {
  getBytes(key: string): Promise<Uint8Array>;
  putBytes(key: string, value: Uint8Array, contentType: string): Promise<void>;
  createResultUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

interface ReplicateObjectConfig {
  apiToken: string;
  baseUrl: string;
  modelVersion: string;
  timeoutMs: number;
  waitSeconds: number;
}

const predictionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/i),
  status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled']),
  output: z.string().url().nullable().optional(),
});

const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isReplicateDeliveryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'));
  } catch {
    return false;
  }
}

async function readLimitedPng(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_OUTPUT_BYTES) throw new Error('Replicate returned an invalid output');
  if (!response.body) throw new Error('Replicate returned an invalid output');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OUTPUT_BYTES) {
      await reader.cancel();
      throw new Error('Replicate returned an invalid output');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('Replicate returned an invalid output');
  }
  return bytes;
}

export class ReplicateObjectProvider implements ObjectRemovalProvider {
  constructor(
    private readonly objects: ObjectRemovalObjects,
    private readonly config: ReplicateObjectConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async remove(input: ProviderInput): Promise<ProviderResult> {
    if (!input.maskKey) throw new Error('Mask is required');
    const startedAt = Date.now();
    const imageKey = `uploads/processing/${input.jobId}/image.png`;
    const maskKey = `uploads/processing/${input.jobId}/mask.png`;

    try {
      const [sourceBytes, sourceMaskBytes] = await Promise.all([
        this.objects.getBytes(input.inputKey),
        this.objects.getBytes(input.maskKey),
      ]);
      const image = await sharp(sourceBytes).rotate().png().toBuffer();
      const imageMetadata = await sharp(image).metadata();
      const maskMetadata = await sharp(sourceMaskBytes).metadata();
      if (!imageMetadata.width || !imageMetadata.height || maskMetadata.width !== imageMetadata.width || maskMetadata.height !== imageMetadata.height) {
        throw new Error('Mask dimensions must match the source image');
      }
      const maskPipeline = sharp(sourceMaskBytes).greyscale().threshold(128);
      const maskStats = await maskPipeline.clone().stats();
      if ((maskStats.channels[0]?.max ?? 0) === 0) throw new Error('Mask must select an area');
      const mask = await maskPipeline.png().toBuffer();

      await Promise.all([
        this.objects.putBytes(imageKey, image, 'image/png'),
        this.objects.putBytes(maskKey, mask, 'image/png'),
      ]);
      const [imageUrl, maskUrl] = await Promise.all([
        this.objects.createResultUrl(imageKey),
        this.objects.createResultUrl(maskKey),
      ]);

      const response = await this.request(new URL('/v1/predictions', this.config.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: `wait=${this.config.waitSeconds}`,
          'Cancel-After': `${Math.ceil(this.config.timeoutMs / 1000)}s`,
        },
        // Vendor contract: https://replicate.com/allenhooo/lama/api
        body: JSON.stringify({
          version: `allenhooo/lama:${this.config.modelVersion}`,
          input: { image: imageUrl, mask: maskUrl },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) throw new Error(`Replicate request failed with status ${response.status}`);

      let prediction = await this.parsePrediction(response);
      while (prediction.status === 'starting' || prediction.status === 'processing') {
        if (Date.now() - startedAt >= this.config.timeoutMs) {
          await this.cancel(prediction.id);
          throw new Error('Replicate request timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const poll = await this.request(new URL(`/v1/predictions/${prediction.id}`, this.config.baseUrl), {
          headers: { Authorization: `Bearer ${this.config.apiToken}` },
          signal: AbortSignal.timeout(Math.max(1000, this.config.timeoutMs - (Date.now() - startedAt))),
        });
        if (!poll.ok) throw new Error(`Replicate request failed with status ${poll.status}`);
        prediction = await this.parsePrediction(poll);
      }

      if (prediction.status !== 'succeeded' || !prediction.output || !isReplicateDeliveryUrl(prediction.output)) {
        throw new Error('Replicate returned an invalid output');
      }
      const output = await this.request(prediction.output, {
        signal: AbortSignal.timeout(Math.max(1000, this.config.timeoutMs - (Date.now() - startedAt))),
      });
      if (!output.ok) throw new Error(`Replicate output failed with status ${output.status}`);
      const result = await readLimitedPng(output);
      const resultMetadata = await sharp(result).metadata();
      if (resultMetadata.width !== imageMetadata.width || resultMetadata.height !== imageMetadata.height) {
        throw new Error('Replicate returned an invalid output');
      }
      const resultKey = `results/object/${input.jobId}.png`;
      await this.objects.putBytes(resultKey, result, 'image/png');
      return { status: 'completed', resultKey };
    } finally {
      await Promise.allSettled([this.objects.delete(imageKey), this.objects.delete(maskKey)]);
    }
  }

  private async parsePrediction(response: Response): Promise<z.infer<typeof predictionSchema>> {
    try {
      return predictionSchema.parse(await response.json());
    } catch {
      throw new Error('Replicate returned an invalid response');
    }
  }

  private async cancel(id: string): Promise<void> {
    try {
      await this.request(new URL(`/v1/predictions/${id}/cancel`, this.config.baseUrl), {
        method: 'POST', headers: { Authorization: `Bearer ${this.config.apiToken}` }, signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best-effort cancellation must not replace the safe credit-refund path.
    }
  }
}
