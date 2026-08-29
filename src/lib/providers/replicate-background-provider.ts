import { z } from 'zod';
import type { BackgroundRemovalProvider } from './background-removal-provider';
import type { ProviderInput, ProviderResult } from './watermark-provider';

interface BackgroundObjects {
  createResultUrl(key: string): Promise<string>;
  putBytes(key: string, value: Uint8Array, contentType: string): Promise<void>;
}

interface ReplicateBackgroundConfig {
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

async function readLimitedBytes(response: Response): Promise<Uint8Array> {
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

export class ReplicateBackgroundProvider implements BackgroundRemovalProvider {
  constructor(
    private readonly objects: BackgroundObjects,
    private readonly config: ReplicateBackgroundConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async remove(input: ProviderInput): Promise<ProviderResult> {
    const startedAt = Date.now();
    const inputUrl = await this.objects.createResultUrl(input.inputKey);
    const endpoint = new URL('/v1/predictions', this.config.baseUrl).toString();

    // Vendor contract: https://replicate.com/851-labs/background-remover/api
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
        Prefer: `wait=${this.config.waitSeconds}`,
        'Cancel-After': `${Math.ceil(this.config.timeoutMs / 1000)}s`,
      },
      body: JSON.stringify({
        version: `851-labs/background-remover:${this.config.modelVersion}`,
        input: {
          image: inputUrl,
          format: 'png',
          reverse: false,
          threshold: 0,
          background_type: 'rgba',
        },
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
    const bytes = await readLimitedBytes(output);
    const resultKey = `results/background/${input.jobId}.png`;
    await this.objects.putBytes(resultKey, bytes, 'image/png');
    return { status: 'completed', resultKey };
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
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // The credit refund path must not be replaced by a best-effort provider cancellation failure.
    }
  }
}
