import sharp from 'sharp';
import { z } from 'zod';
import type { ProviderInput, ProviderResult, WatermarkProvider } from './watermark-provider';

interface BinaryObjects {
  getBytes(key: string): Promise<Uint8Array>;
  putBytes(key: string, value: Uint8Array, contentType: string): Promise<void>;
}

interface DewatermarkConfig {
  apiKey: string;
  baseUrl: string;
  predictMode: '3.0' | '4.0';
  timeoutMs: number;
}

const responseSchema = z.object({
  edited_image: z.object({ image: z.string().min(1) }),
  event_id: z.string().optional(),
  session_id: z.string().optional(),
});

function decodeImage(value: string): Uint8Array {
  const base64 = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Dewatermark returned an invalid response');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0) throw new Error('Dewatermark returned an invalid response');
  return bytes;
}

export class DewatermarkProvider implements WatermarkProvider {
  constructor(
    private readonly objects: BinaryObjects,
    private readonly config: DewatermarkConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async remove(input: ProviderInput): Promise<ProviderResult> {
    const source = await this.objects.getBytes(input.inputKey);
    const jpeg = await sharp(source, { failOn: 'error' })
      .rotate()
      .resize({ width: 6000, height: 6000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 95 })
      .toBuffer();

    // Vendor contract: https://dewatermark.ai/api-document
    const form = new FormData();
    form.append('original_preview_image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'image.jpg');
    form.append('remove_text', 'false');
    form.append('predict_mode', this.config.predictMode);

    const endpoint = new URL('/api/object_removal/v3/erase_watermark', this.config.baseUrl).toString();
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { 'X-API-KEY': this.config.apiKey },
      body: form,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) throw new Error(`Dewatermark request failed with status ${response.status}`);

    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(await response.json());
    } catch {
      throw new Error('Dewatermark returned an invalid response');
    }

    const resultKey = `results/${input.jobId}.jpg`;
    await this.objects.putBytes(resultKey, decodeImage(parsed.edited_image.image), 'image/jpeg');
    return { status: 'completed', resultKey };
  }
}
