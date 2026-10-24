import { z } from 'zod';

// Server-only transport. Vendor contract: https://dewatermark.ai/api-document
// Keep billing/recovery decisions in the caller: a transport error is not a failed task.
const API_ORIGIN = 'https://platform.dewatermark.ai';
const STORAGE_HOSTS = new Set([
  'storage.googleapis.com',
  // Exact upload endpoint returned by the official API and verified during the
  // authorized 2026-10-24 contract acceptance. Never trust a wildcard suffix.
  'dewatermark-videos-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com',
  // The completed-task response uses a separate result bucket (same acceptance).
  'dewatermark-videos-result-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com',
]);
type RequestOutcome = 'not-submitted' | 'rejected' | 'unknown';
type ErrorCode = 'invalid-input' | 'unsafe-url' | 'network' | 'http' | 'invalid-response' | 'limit';

export class DewatermarkRequestError extends Error {
  readonly mayHaveBeenSubmitted: boolean;
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly outcome: RequestOutcome = 'not-submitted',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DewatermarkRequestError';
    this.mayHaveBeenSubmitted = outcome === 'unknown';
  }
}

export interface DewatermarkClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxDownloadBytes?: number;
}
export interface ImageRequest {
  mode: 'auto' | 'pro' | 'manual';
  image?: Uint8Array;
  sessionId?: string;
  maskBrush?: Uint8Array;
  maskBase?: string;
  removeText?: boolean;
  predictMode?: 'old' | '3.0' | '4.0';
}
export interface ImageResponse {
  image: Uint8Array;
  imageId?: string;
  eventId?: string;
  sessionId?: string;
  watermarkMask?: string;
  mask?: string;
}
export interface VideoTask {
  taskId: string;
  status: 'CREATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  durationSeconds?: number;
  hasWatermark?: boolean;
  downloadUrl?: string;
}

const imageSchema = z.object({
  edited_image: z.object({ image: z.string().min(1), image_id: z.string().optional(), watermark_mask: z.string().optional(), mask: z.string().optional() }),
  event_id: z.string().optional(), session_id: z.string().optional(),
});
const uploadSchema = z.object({ task_id: z.string().min(1), upload_signed_url: z.string().min(1) });
const videoSchema = z.object({
  task_id: z.string().min(1), status: z.enum(['CREATED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  progress: z.number().min(0).max(1).nullish(), duration: z.number().positive().nullish(),
  has_watermark: z.boolean().nullish(), download_signed_url: z.string().nullish(),
});

function inputError(): never {
  throw new DewatermarkRequestError('Dewatermark input is invalid', 'invalid-input');
}
function taskId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) inputError();
  return value;
}
function storageUrl(value: string): string {
  try {
    const url = new URL(value);
    // No arbitrary URL, credentials, alternate port or redirect may become a
    // server-side fetch, even when an upstream response supplies the URL.
    if (url.protocol !== 'https:' || !STORAGE_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.hash) throw new Error();
    return value;
  } catch {
    throw new DewatermarkRequestError('Dewatermark storage URL is not trusted', 'unsafe-url');
  }
}
function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.byteLength || bytes.toString('base64') !== value) throw new Error();
  return bytes;
}
async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel().catch(() => undefined);
    throw new DewatermarkRequestError('Dewatermark response exceeds the byte limit', 'limit');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new DewatermarkRequestError('Dewatermark response exceeds the byte limit', 'limit');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DewatermarkRequestError) throw error;
    throw new DewatermarkRequestError('Dewatermark response stream could not be read', 'network');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return bytes;
}

export class DewatermarkClient {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxDownloadBytes: number;

  constructor(private readonly config: DewatermarkClientOptions) {
    if (!config.apiKey.trim()) inputError();
    this.request = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.maxResponseBytes = config.maxResponseBytes ?? 48 * 1024 * 1024;
    this.maxDownloadBytes = config.maxDownloadBytes ?? 256 * 1024 * 1024;
    if (![this.timeoutMs, this.maxResponseBytes, this.maxDownloadBytes].every((value) => Number.isSafeInteger(value) && value > 0)) inputError();
  }

  private async response(url: string, init: RequestInit, charged = false): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new DewatermarkRequestError('Dewatermark request did not return a usable response', 'network', charged ? 'unknown' : 'not-submitted');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const outcome = charged ? (response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected') : 'not-submitted';
      throw new DewatermarkRequestError(`Dewatermark request failed with status ${response.status}`, 'http', outcome, response.status);
    }
    return response;
  }

  private async json(path: string, method: 'POST' | 'GET', form?: FormData, charged = false): Promise<unknown> {
    const response = await this.response(`${API_ORIGIN}${path}`, { method, headers: { 'X-API-KEY': this.config.apiKey }, ...(form ? { body: form } : {}) }, charged);
    try {
      return JSON.parse(new TextDecoder().decode(await boundedBytes(response, this.maxResponseBytes)));
    } catch (error) {
      throw new DewatermarkRequestError('Dewatermark returned an invalid response', error instanceof DewatermarkRequestError ? error.code : 'invalid-response', charged ? 'unknown' : 'not-submitted');
    }
  }

  async processImage(input: ImageRequest): Promise<ImageResponse> {
    if (input.mode !== 'auto' && input.mode !== 'pro' && input.mode !== 'manual') inputError();
    if (input.mode === 'manual') {
      // Verified first-refinement contract (2026-10-24): current JPEG + session
      // + brush. Session-only and an inferred textual mask_base were refused.
      if (!input.image?.byteLength || !input.sessionId?.trim() || !input.maskBrush?.byteLength || input.maskBase) inputError();
    } else if (!input.image?.byteLength || input.sessionId || input.maskBrush || input.maskBase) inputError();
    if (input.predictMode && !['old', '3.0', '4.0'].includes(input.predictMode)) inputError();
    const form = new FormData();
    if (input.image) form.append('original_preview_image', new Blob([new Uint8Array(input.image)], { type: 'image/jpeg' }), 'image.jpg');
    if (input.mode !== 'pro') {
      if (input.sessionId) form.append('session_id', input.sessionId);
      if (input.maskBase) form.append('mask_base', input.maskBase);
      if (input.maskBrush) form.append('mask_brush', new Blob([new Uint8Array(input.maskBrush)], { type: 'image/png' }), 'mask.png');
      form.append('remove_text', String(input.removeText ?? false));
      form.append('predict_mode', input.predictMode ?? '4.0');
    }
    const path = input.mode === 'pro' ? '/api/object_removal/v1/erase_watermark_pro' : '/api/object_removal/v3/erase_watermark';
    const payload = await this.json(path, 'POST', form, true);
    try {
      const parsed = imageSchema.parse(payload);
      return {
        image: decodeBase64(parsed.edited_image.image),
        ...(parsed.edited_image.image_id !== undefined ? { imageId: parsed.edited_image.image_id } : {}),
        ...(parsed.event_id !== undefined ? { eventId: parsed.event_id } : {}),
        ...(parsed.session_id !== undefined ? { sessionId: parsed.session_id } : {}),
        ...(parsed.edited_image.watermark_mask !== undefined ? { watermarkMask: parsed.edited_image.watermark_mask } : {}),
        ...(parsed.edited_image.mask !== undefined ? { mask: parsed.edited_image.mask } : {}),
      };
    } catch {
      throw new DewatermarkRequestError('Dewatermark returned an invalid response', 'invalid-response', 'unknown');
    }
  }

  async createVideoUpload(): Promise<{ taskId: string; uploadUrl: string }> {
    const payload = await this.json('/api/video/v1/upload', 'POST', new FormData());
    const result = uploadSchema.safeParse(payload);
    if (!result.success) throw new DewatermarkRequestError('Dewatermark returned an invalid response', 'invalid-response');
    return { taskId: taskId(result.data.task_id), uploadUrl: storageUrl(result.data.upload_signed_url) };
  }

  async uploadVideo(url: string, body: Uint8Array | ReadableStream<Uint8Array>, byteLength?: number): Promise<void> {
    storageUrl(url);
    if (byteLength !== undefined && (!Number.isSafeInteger(byteLength) || byteLength <= 0)) inputError();
    const isStream = body instanceof ReadableStream;
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (byteLength !== undefined) headers['Content-Length'] = String(byteLength);
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'PUT', headers,
      body: isStream ? body : new Uint8Array(body),
      ...(isStream ? { duplex: 'half' as const } : {}),
    };
    await this.response(url, init);
  }

  async submitVideo(input: { taskId: string; maskBrush?: Uint8Array }): Promise<void> {
    const form = new FormData();
    form.append('task_id', taskId(input.taskId));
    if (input.maskBrush) {
      if (!input.maskBrush.byteLength) inputError();
      form.append('mask_brush', new Blob([new Uint8Array(input.maskBrush)], { type: 'image/png' }), 'mask.png');
    }
    // Step 3 does not specify a JSON response contract. Acceptance is HTTP success;
    // the caller must subsequently poll the task ID already created in Step 1.
    const response = await this.response(`${API_ORIGIN}/api/video/v1/tasks`, { method: 'POST', headers: { 'X-API-KEY': this.config.apiKey }, body: form }, true);
    await response.body?.cancel().catch(() => undefined);
  }

  async getVideoTask(id: string): Promise<VideoTask> {
    const payload = await this.json(`/api/video/v1/tasks/${taskId(id)}`, 'GET');
    const result = videoSchema.safeParse(payload);
    if (!result.success || result.data.task_id !== id || (result.data.status === 'COMPLETED' && !result.data.download_signed_url)) throw new DewatermarkRequestError('Dewatermark returned an invalid response', 'invalid-response');
    const value = result.data;
    return {
      taskId: value.task_id, status: value.status,
      ...(value.progress != null ? { progress: value.progress } : {}),
      ...(value.duration != null ? { durationSeconds: value.duration } : {}),
      ...(value.has_watermark != null ? { hasWatermark: value.has_watermark } : {}),
      ...(value.download_signed_url ? { downloadUrl: storageUrl(value.download_signed_url) } : {}),
    };
  }

  async downloadResult(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const response = await this.response(storageUrl(url), { method: 'GET' });
    return { bytes: await boundedBytes(response, this.maxDownloadBytes), contentType: response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream' };
  }
}
