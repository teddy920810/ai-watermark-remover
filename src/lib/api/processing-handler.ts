import type { ProcessingService } from '../processing/processing-service';
import type { ProcessingJob, ProcessingQuote } from '../processing/contracts';
import { ProcessingError, operationSchema } from '../processing/contracts';
import { z } from 'zod';

export interface UploadDeclaration { kind: 'image' | 'video' | 'mask'; contentType: string; byteSize: number; inputArtifactId?: string }
export interface ProcessingApiRuntime {
  service: Pick<ProcessingService, 'capabilities' | 'quote' | 'submit' | 'get' | 'list'>;
  beginUpload(ownerId: string, declaration: UploadDeclaration): Promise<unknown>;
  completeUpload(ownerId: string, id: string): Promise<unknown>;
  getUpload(ownerId: string, id: string): Promise<unknown>;
  projectJob(ownerId: string, job: ProcessingJob): Promise<unknown>;
  projectQuote(ownerId: string, quote: ProcessingQuote): Promise<unknown>;
  balances(ownerId: string, email?: string): Promise<{ processingCredits: number; freeUses: number }>;
  download(ownerId: string, id: string): Promise<unknown>;
  dispatch(): Promise<void>;
}
export interface ProcessingHandlerOptions {
  getRuntime(): ProcessingApiRuntime;
  getSession(request: Request): Promise<{ user: { id: string; email?: string } } | null | undefined>;
  origin: string;
}

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const uploadSchema = z.object({ kind: z.enum(['image', 'video', 'mask']), contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']), byteSize: z.number().int().positive().max(100 * 1024 * 1024), inputArtifactId: identifier.optional() });
const quoteSchema = z.object({ operation: operationSchema, inputArtifactId: identifier, maskArtifactId: identifier.optional(), parentJobId: identifier.optional() });
const submitSchema = z.object({ quoteId: identifier, idempotencyKey: z.string().min(1).max(200) });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } });
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ProcessingError('invalid_body', 'Send a JSON request');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 32_768)) throw new ProcessingError('body_limit', 'Request is too large', 413);
  if (!request.body) throw new ProcessingError('invalid_body', 'Send a valid JSON request');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        await reader.cancel().catch(() => undefined);
        throw new ProcessingError('body_limit', 'Request is too large', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { throw new ProcessingError('invalid_body', 'Send a valid JSON request'); }
}
async function dispatch(runtime: ProcessingApiRuntime) {
  // The durable outbox owns recovery. An invocation failure must not lead the
  // browser to create another operation or hide the operation already reserved.
  try { await runtime.dispatch(); } catch { /* periodic dispatch reconciles it */ }
}

export function createProcessingHandler(options: ProcessingHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '');
      if (request.method === 'GET' && path === 'capabilities') return response({ operations: options.getRuntime().service.capabilities() });
      if (!['GET', 'POST'].includes(request.method)) return response({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);
      const session = await options.getSession(request);
      if (!session?.user.id) return response({ error: 'Sign in with Google to continue.', code: 'login_required' }, 401);
      if (request.method === 'POST' && request.headers.get('origin') !== options.origin) return response({ error: 'Request origin is not allowed.', code: 'invalid_origin' }, 403);
      const ownerId = session.user.id;
      const runtime = options.getRuntime();
      if (request.method === 'GET' && path === 'me') return response(await runtime.balances(ownerId, session.user.email));
      if (request.method === 'POST' && path === 'uploads') return response(await runtime.beginUpload(ownerId, uploadSchema.parse(await body(request))), 201);
      const upload = path.match(/^uploads\/([A-Za-z0-9_-]{1,160})(\/complete)?$/);
      if (upload && request.method === 'POST' && upload[2]) {
        const result = await runtime.completeUpload(ownerId, upload[1]);
        await dispatch(runtime);
        return response(result, 202);
      }
      if (upload && request.method === 'GET' && !upload[2]) return response(await runtime.getUpload(ownerId, upload[1]));
      if (request.method === 'POST' && path === 'quotes') {
        const quote = await runtime.service.quote({ ...quoteSchema.parse(await body(request)), ownerId });
        return response(await runtime.projectQuote(ownerId, quote), 201);
      }
      if (path === 'jobs' && request.method === 'POST') {
        const job = await runtime.service.submit({ ...submitSchema.parse(await body(request)), ownerId });
        await dispatch(runtime);
        return response(await runtime.projectJob(ownerId, job), 202);
      }
      if (path === 'jobs' && request.method === 'GET') {
        const jobs = await runtime.service.list(ownerId);
        return response({ jobs: await Promise.all(jobs.map((job) => runtime.projectJob(ownerId, job))) });
      }
      const jobPath = path.match(/^jobs\/([A-Za-z0-9_-]{1,160})(\/download)?$/);
      if (jobPath && request.method === 'GET') {
        if (jobPath[2]) return response(await runtime.download(ownerId, jobPath[1]));
        return response(await runtime.projectJob(ownerId, await runtime.service.get(ownerId, jobPath[1])));
      }
      return response({ error: 'Endpoint not found.', code: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof ProcessingError) return response({ error: error.message, code: error.code }, error.status);
      if (error instanceof z.ZodError) return response({ error: 'Invalid processing request.', code: 'invalid_request' }, 400);
      return response({ error: 'Processing service is temporarily unavailable. Your existing task has been retained.', code: 'service_unavailable' }, 503);
    }
  };
}
