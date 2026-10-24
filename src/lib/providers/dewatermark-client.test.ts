import { describe, expect, it, vi } from 'vitest';
import { DewatermarkClient, DewatermarkRequestError } from './dewatermark-client';

const api = 'https://platform.dewatermark.ai';
const signedUrl = 'https://storage.googleapis.com/vendor-bucket/video.mp4?X-Goog-Signature=private-signature';
const imageResponse = () => Response.json({
  edited_image: { image: Buffer.from('image-result').toString('base64'), image_id: 'image-1', watermark_mask: 'bWFzaw==', mask: 'bWFzaw==' },
  session_id: 'session-1', event_id: 'event-1',
});
function clientWith(request: ReturnType<typeof vi.fn>, options = {}) {
  return new DewatermarkClient({ apiKey: 'server-key', fetchImpl: request as typeof fetch, ...options });
}

describe('DewatermarkClient image contracts', () => {
  it('uses documented v3 automatic multipart fields and preserves refinement metadata', async () => {
    const request = vi.fn().mockResolvedValue(imageResponse());
    const result = await clientWith(request).processImage({ mode: 'auto', image: new Uint8Array([1, 2]) });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`${api}/api/object_removal/v3/erase_watermark`);
    expect(init).toMatchObject({ method: 'POST', headers: { 'X-API-KEY': 'server-key' }, redirect: 'error' });
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(['original_preview_image', 'remove_text', 'predict_mode']);
    expect((form.get('original_preview_image') as File).type).toBe('image/jpeg');
    expect(form.get('predict_mode')).toBe('4.0');
    expect(form.get('remove_text')).toBe('false');
    expect(result).toEqual({ image: Buffer.from('image-result'), sessionId: 'session-1', imageId: 'image-1', eventId: 'event-1', watermarkMask: 'bWFzaw==', mask: 'bWFzaw==' });
  });

  it('sends PRO to its own endpoint with only the documented image field', async () => {
    const request = vi.fn().mockResolvedValue(imageResponse());
    await clientWith(request).processImage({ mode: 'pro', image: new Uint8Array([1]) });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`${api}/api/object_removal/v1/erase_watermark_pro`);
    expect([...(init.body as FormData).keys()]).toEqual(['original_preview_image']);
  });

  it('sends the verified current JPEG plus session and brush refinement contract without an inferred base mask', async () => {
    const request = vi.fn().mockResolvedValue(imageResponse());
    await clientWith(request).processImage({ mode: 'manual', image: new Uint8Array([1]), sessionId: 'session-1', maskBrush: new Uint8Array([1]), removeText: false, predictMode: '3.0' });
    const form = request.mock.calls[0][1].body as FormData;
    expect([...form.keys()]).toEqual(['original_preview_image', 'session_id', 'mask_brush', 'remove_text', 'predict_mode']);
    expect((form.get('original_preview_image') as File).type).toBe('image/jpeg');
    expect(form.get('session_id')).toBe('session-1');
    expect(form.get('mask_base')).toBeNull();
    expect((form.get('mask_brush') as File).type).toBe('image/png');
    expect(form.get('predict_mode')).toBe('3.0');
  });

  it('rejects invalid or ambiguous mode input before any request', async () => {
    const request = vi.fn();
    const client = clientWith(request);
    await expect(client.processImage({ mode: 'manual', sessionId: 'session-1' })).rejects.toThrow('Dewatermark input is invalid');
    await expect(client.processImage({ mode: 'manual', sessionId: 'session-1', maskBrush: new Uint8Array([1]) })).rejects.toThrow('Dewatermark input is invalid');
    await expect(client.processImage({ mode: 'pro', image: new Uint8Array([1]), sessionId: 'session-1' })).rejects.toThrow('Dewatermark input is invalid');
    expect(request).not.toHaveBeenCalled();
  });

  it('never retries a charged call and marks a lost response as unknown without revealing secrets', async () => {
    const request = vi.fn().mockRejectedValue(new Error(`server-key ${signedUrl}`));
    const result = clientWith(request).processImage({ mode: 'auto', image: new Uint8Array([1]) });
    await expect(result).rejects.toMatchObject({ code: 'network', outcome: 'unknown', mayHaveBeenSubmitted: true });
    await expect(result).rejects.toThrow('Dewatermark request did not return a usable response');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not call an HTTP 5xx a definite failed operation and never includes its response body', async () => {
    const request = vi.fn().mockResolvedValue(new Response('private vendor body', { status: 503 }));
    await expect(clientWith(request).processImage({ mode: 'auto', image: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'http', status: 503, outcome: 'unknown' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps a provider HTTP timeout ambiguous rather than declaring it rejected', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 408 }));
    await expect(clientWith(request).processImage({ mode: 'auto', image: new Uint8Array([1]) })).rejects.toMatchObject({ outcome: 'unknown', mayHaveBeenSubmitted: true });
  });

  it('treats malformed successful image data as unknown and bounds streamed JSON', async () => {
    const malformed = vi.fn().mockResolvedValue(Response.json({ edited_image: { image: 'not base64?' } }));
    await expect(clientWith(malformed).processImage({ mode: 'auto', image: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'invalid-response', outcome: 'unknown' });
    const oversized = vi.fn().mockResolvedValue(new Response('x'.repeat(33)));
    await expect(clientWith(oversized, { maxResponseBytes: 32 }).processImage({ mode: 'auto', image: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'limit', outcome: 'unknown' });
  });
});

describe('DewatermarkClient video contracts and result security', () => {
  it('allows the exact BytePlus storage host verified in the official API response without a wildcard', async () => {
    const url = 'https://dewatermark-videos-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com/video.mp4?signature=private';
    const request = vi.fn().mockResolvedValueOnce(Response.json({ task_id: 'task-1', upload_signed_url: url })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = clientWith(request); const task = await client.createVideoUpload();
    expect(task.uploadUrl).toBe(url); await client.uploadVideo(task.uploadUrl, new Uint8Array([1]));
    expect(request.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/octet-stream' });
  });
  it('downloads an existing completed task from the separately verified exact BytePlus result host', async () => {
    const url = 'https://dewatermark-videos-result-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com/result.mp4?signature=private';
    const request = vi.fn().mockResolvedValueOnce(Response.json({ task_id: 'task-1', status: 'COMPLETED', download_signed_url: url }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } }));
    const client = clientWith(request); const task = await client.getVideoTask('task-1');
    await expect(client.downloadResult(task.downloadUrl!)).resolves.toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
    expect(request.mock.calls.every(([, init]) => init.method === 'GET' && init.redirect === 'error')).toBe(true);
    expect(request.mock.calls[1][1].headers).toBeUndefined();
  });
  it.each(['https://dewatermark-videos-result-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com.evil.test/result.mp4', 'https://dewatermark-videos-result-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com:444/result.mp4'])('refuses a result-host lookalike or nonstandard port: %s', async (url) => {
    const request = vi.fn();
    await expect(clientWith(request).downloadResult(url)).rejects.toMatchObject({ code: 'unsafe-url' });
    expect(request).not.toHaveBeenCalled();
  });
  it('creates the upload task, uploads PUT octet-stream without API key, then submits the same task with PNG mask', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ task_id: 'task-1', upload_signed_url: signedUrl, status: 'CREATED' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ task_id: 'task-1' }));
    const client = clientWith(request);
    const upload = await client.createVideoUpload();
    expect(upload).toEqual({ taskId: 'task-1', uploadUrl: signedUrl });
    await client.uploadVideo(upload.uploadUrl, new Uint8Array([1, 2, 3]));
    await client.submitVideo({ taskId: upload.taskId, maskBrush: new Uint8Array([1]) });
    expect(request.mock.calls[0][0]).toBe(`${api}/api/video/v1/upload`);
    expect(request.mock.calls[1]).toEqual([signedUrl, expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, redirect: 'error' })]);
    expect(request.mock.calls[2][0]).toBe(`${api}/api/video/v1/tasks`);
    const form = request.mock.calls[2][1].body as FormData;
    expect(form.get('task_id')).toBe('task-1');
    expect((form.get('mask_brush') as File).type).toBe('image/png');
  });

  it('returns actual video progress, output URL, duration and detection without manufacturing completion', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ task_id: 'task-1', status: 'COMPLETED', progress: 1, duration: 4.25, has_watermark: true, download_signed_url: signedUrl }));
    await expect(clientWith(request).getVideoTask('task-1')).resolves.toEqual({ taskId: 'task-1', status: 'COMPLETED', progress: 1, durationSeconds: 4.25, hasWatermark: true, downloadUrl: signedUrl });
    expect(request.mock.calls[0][1].method).toBe('GET');
  });

  it('does not turn a polling failure into a confirmed provider failure/refund', async () => {
    const request = vi.fn().mockRejectedValue(new Error('lost polling response'));
    await expect(clientWith(request).getVideoTask('task-1')).rejects.toMatchObject({ code: 'network', outcome: 'not-submitted', mayHaveBeenSubmitted: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('accepts a successful submit with no documented response body and then polls the existing task', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(clientWith(request).submitVideo({ taskId: 'task-1' })).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate metadata while optional video fields are null', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ task_id: 'task-1', status: 'CREATED', progress: null, duration: null, has_watermark: null, download_signed_url: null }));
    await expect(clientWith(request).getVideoTask('task-1')).resolves.toEqual({ taskId: 'task-1', status: 'CREATED' });
  });

  it('rejects inconsistent task identity, invalid progress and missing completed output', async () => {
    for (const payload of [
      { task_id: 'other-task', status: 'PROCESSING', progress: 0.5 },
      { task_id: 'task-1', status: 'PROCESSING', progress: 1.5 },
      { task_id: 'task-1', status: 'COMPLETED', progress: 1 },
    ]) {
      const request = vi.fn().mockResolvedValue(Response.json(payload));
      await expect(clientWith(request).getVideoTask('task-1')).rejects.toBeInstanceOf(DewatermarkRequestError);
    }
  });

  it.each(['http://storage.googleapis.com/bucket/x', 'https://storage.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'https://u:p@storage.googleapis.com/x', 'https://storage.googleapis.com:444/x', 'https://storage.googleapis.com/x#fragment', 'https://evil.bytepluses.com/x', 'https://dewatermark-videos-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com.evil.test/x', 'https://dewatermark-videos-asia-southeast1-prod.tos-ap-southeast-1.bytepluses.com:444/x'])('rejects unsafe storage URL %s before sending bytes or secrets', async (url) => {
    const request = vi.fn();
    const client = clientWith(request);
    await expect(client.downloadResult(url)).rejects.toMatchObject({ code: 'unsafe-url' });
    await expect(client.uploadVideo(url, new Uint8Array([1]))).rejects.toMatchObject({ code: 'unsafe-url' });
    expect(request).not.toHaveBeenCalled();
  });

  it('downloads only bounded storage bytes, disallows redirects and omits the API key', async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } }));
    await expect(clientWith(request).downloadResult(signedUrl)).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' });
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(request.mock.calls[0][1].headers).toBeUndefined();
    const oversized = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    await expect(clientWith(oversized, { maxDownloadBytes: 2 }).downloadResult(signedUrl)).rejects.toMatchObject({ code: 'limit' });
  });

  it('redacts a failing response stream and rejects an excessive declared body size', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(`private ${signedUrl}`)); } });
    const request = vi.fn().mockResolvedValue(new Response(stream));
    await expect(clientWith(request).downloadResult(signedUrl)).rejects.toMatchObject({ code: 'network', message: 'Dewatermark response stream could not be read' });
    const declared = vi.fn().mockResolvedValue(new Response(null, { headers: { 'Content-Length': '999' } }));
    await expect(clientWith(declared, { maxDownloadBytes: 2 }).downloadResult(signedUrl)).rejects.toMatchObject({ code: 'limit' });
  });
});
