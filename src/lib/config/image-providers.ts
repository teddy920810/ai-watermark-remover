import { z } from 'zod';

const schema = z.object({
  BACKGROUND_REMOVAL_PROVIDER: z.enum(['mock', 'replicate']).optional(),
  OBJECT_REMOVAL_PROVIDER: z.enum(['mock', 'replicate']).optional(),
  REPLICATE_API_TOKEN: z.string().min(1).optional(),
  REPLICATE_BASE_URL: z.url().default('https://api.replicate.com'),
  REPLICATE_BACKGROUND_MODEL_VERSION: z.string().regex(/^[a-f0-9]{64}$/).default('a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc'),
  REPLICATE_LAMA_MODEL_VERSION: z.string().regex(/^[a-f0-9]{64}$/).default('cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72'),
  REPLICATE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120_000).default(45_000),
  REPLICATE_WAIT_SECONDS: z.coerce.number().int().min(1).max(60).default(20),
}).superRefine((env, context) => {
  if (env.BACKGROUND_REMOVAL_PROVIDER === 'replicate' && !env.REPLICATE_API_TOKEN) context.addIssue({ code: 'custom', path: ['REPLICATE_API_TOKEN'], message: 'Required for Replicate background removal' });
  if (env.OBJECT_REMOVAL_PROVIDER === 'replicate' && !env.REPLICATE_API_TOKEN) context.addIssue({ code: 'custom', path: ['REPLICATE_API_TOKEN'], message: 'Required for Replicate object removal' });
});

/** The original image vendor settings, shared by Web/Worker without unrelated legacy initialization. */
export function readImageProviderConfig(source: Record<string, string | undefined>) {
  const env = schema.parse(source);
  return { ...env,
    BACKGROUND_REMOVAL_PROVIDER: env.BACKGROUND_REMOVAL_PROVIDER ?? (env.REPLICATE_API_TOKEN ? 'replicate' as const : 'mock' as const),
    OBJECT_REMOVAL_PROVIDER: env.OBJECT_REMOVAL_PROVIDER ?? (env.REPLICATE_API_TOKEN ? 'replicate' as const : 'mock' as const),
  };
}
export type ImageProviderConfig = ReturnType<typeof readImageProviderConfig>;
