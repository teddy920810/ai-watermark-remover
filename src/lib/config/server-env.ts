import { z } from 'zod';

const schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1).default('watermark'),
  R2_ENDPOINT: z.url().optional(),
  MOCK_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(0),
  WATERMARK_PROVIDER: z.enum(['mock', 'dewatermark']).default('mock'),
  DEWATERMARK_API_KEY: z.string().min(1).optional(),
  DEWATERMARK_BASE_URL: z.url().default('https://platform.dewatermark.ai'),
  DEWATERMARK_PREDICT_MODE: z.enum(['3.0', '4.0']).default('4.0'),
  DEWATERMARK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
}).superRefine((env, context) => {
  if (env.WATERMARK_PROVIDER === 'dewatermark' && !env.DEWATERMARK_API_KEY) {
    context.addIssue({ code: 'custom', path: ['DEWATERMARK_API_KEY'], message: 'Required for Dewatermark provider' });
  }
});

export function getServerEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = schema.parse(source);
  const endpoint = env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) throw new Error('R2_ENDPOINT or R2_ACCOUNT_ID is required');
  return { ...env, R2_ENDPOINT: endpoint };
}
