import { createProcessingHandler } from '../api/processing-handler';
import type { ProcessingApiRuntime } from '../api/processing-handler';
import { getServerEnv } from '../config/server-env';
import { cloudRunTriggerFromEnvironment } from './cloud-run-trigger';
import { createProcessingRuntime } from './processing-services';
import type { ProcessingRuntime, ProcessingRuntimeConfig } from './processing-services';

type RuntimeDependencies = {
  factory?: (config: ProcessingRuntimeConfig) => ProcessingRuntime;
  resolveTrigger?: typeof cloudRunTriggerFromEnvironment;
};

/** Importing this module neither reads credentials nor opens a database connection. */
export function createServerProcessingRuntimeAccessor(source: NodeJS.ProcessEnv = process.env, dependencies: RuntimeDependencies = {}) {
  let cached: ProcessingRuntime | undefined;
  return (): ProcessingRuntime => {
    if (cached) return cached;
    const env = getServerEnv(source);
    const trigger = (dependencies.resolveTrigger ?? cloudRunTriggerFromEnvironment)(source);
    cached = (dependencies.factory ?? createProcessingRuntime)({
      r2: { endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET },
      databaseUrl: env.DATABASE_URL, apiKey: env.DEWATERMARK_API_KEY, ffprobePath: env.FFPROBE_PATH,
      legacyProvider: { mode: env.WATERMARK_PROVIDER, baseUrl: env.DEWATERMARK_BASE_URL, predictMode: env.DEWATERMARK_PREDICT_MODE, timeoutMs: env.DEWATERMARK_TIMEOUT_MS, mockDelayMs: env.MOCK_PROCESSING_DELAY_MS },
      // Web admission stays closed until it can durably start and monitor work.
      // Worker-side runtimes remain directly runnable without a web trigger.
      providerMode: env.PROCESSING_PROVIDER, enabled: env.PROCESSING_ENABLED && Boolean(trigger), priceVersion: env.PROCESSING_PRICE_VERSION, trigger,
    });
    return cached;
  };
}
export const getServerProcessingRuntime = createServerProcessingRuntimeAccessor();

function publicOrigin(source: NodeJS.ProcessEnv) {
  if (!source.BETTER_AUTH_URL) throw new Error('Public application origin is required');
  const url = new URL(source.BETTER_AUTH_URL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Public application origin must be a plain HTTPS origin');
  return url.origin;
}
type Session = (request: Request) => Promise<{ user: { id: string; email?: string } } | null | undefined>;
interface ServerHandlerOptions {
  source?: NodeJS.ProcessEnv;
  getRuntime?: () => ProcessingApiRuntime;
  loadSession?: () => Promise<Session>;
}
export function createServerProcessingHandler(options: ServerHandlerOptions = {}) {
  const source = options.source ?? process.env;
  let session: Session | undefined;
  return async (request: Request): Promise<Response> => {
    try {
      const origin = publicOrigin(source);
      const runtime = options.getRuntime ?? getServerProcessingRuntime;
      return await createProcessingHandler({
        origin, getRuntime: runtime,
        getSession: async (incoming) => {
          // Capabilities reach the handler before this function is called. The
          // auth module owns its own database adapter, so it must stay lazy.
          session ??= await (options.loadSession ?? (async () => (await import('../auth')).getSession))();
          return session(incoming);
        },
      })(request);
    } catch {
      return new Response(JSON.stringify({ error: 'Processing service is temporarily unavailable.', code: 'service_unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } });
    }
  };
}
export const handleServerProcessingRequest = createServerProcessingHandler();
