import { z } from 'zod';
import { readImageProviderConfig } from './image-providers';

const schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1).default('watermark'),
  R2_ENDPOINT: z.url().optional(),
  DATABASE_URL: z.url(),
  DEWATERMARK_API_KEY: z.string().min(1).optional(),
  PROCESSING_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  PROCESSING_PROVIDER: z.enum(['mock', 'dewatermark']).default('mock'),
  PROCESSING_PRICE_VERSION: z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/).default('processing-v1'),
  FFPROBE_PATH: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url().optional(),

}).superRefine((env, context) => {
  if (env.PROCESSING_ENABLED && env.PROCESSING_PROVIDER === 'dewatermark' && !env.DEWATERMARK_API_KEY) {
    context.addIssue({ code: 'custom', path: ['DEWATERMARK_API_KEY'], message: 'Required for enabled processing provider' });
  }
});

export function getServerEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = schema.parse(source);
  const endpoint = env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) throw new Error('R2_ENDPOINT or R2_ACCOUNT_ID is required');
  return { ...env, ...readImageProviderConfig(source), R2_ENDPOINT: endpoint };
}
