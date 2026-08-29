import { getServerEnv } from './config/server-env';
import { JobService } from './jobs/job-service';
import { R2JobStore } from './jobs/r2-job-store';
import { DewatermarkProvider } from './providers/dewatermark-provider';
import { MockWatermarkProvider } from './providers/mock-provider';
import { MockBackgroundProvider } from './providers/mock-background-provider';
import { ReplicateBackgroundProvider } from './providers/replicate-background-provider';
import type { WatermarkProvider } from './providers/watermark-provider';
import { R2ObjectStore } from './r2/r2-object-store';

let cached: ReturnType<typeof createServices> | undefined;

function createServices() {
  const env = getServerEnv();
  const objects = new R2ObjectStore({
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
  const jobStore = new R2JobStore(objects);
  const benefits = new PostgresBenefitStore(new Pool({
    connectionString: env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  }));
  const provider: WatermarkProvider = env.WATERMARK_PROVIDER === 'dewatermark'
    ? new DewatermarkProvider(objects, {
        apiKey: env.DEWATERMARK_API_KEY as string,
        baseUrl: env.DEWATERMARK_BASE_URL,
        predictMode: env.DEWATERMARK_PREDICT_MODE,
        timeoutMs: env.DEWATERMARK_TIMEOUT_MS,
      })
    : new MockWatermarkProvider(objects, env.MOCK_PROCESSING_DELAY_MS);
  const backgroundProvider = env.BACKGROUND_REMOVAL_PROVIDER === 'replicate'
    ? new ReplicateBackgroundProvider(objects, {
        apiToken: env.REPLICATE_API_TOKEN as string,
        baseUrl: env.REPLICATE_BASE_URL,
        modelVersion: env.REPLICATE_BACKGROUND_MODEL_VERSION,
        timeoutMs: env.REPLICATE_TIMEOUT_MS,
        waitSeconds: env.REPLICATE_WAIT_SECONDS,
      })
    : new MockBackgroundProvider(objects, env.MOCK_PROCESSING_DELAY_MS);
  return {
    objects,
    benefits,
    jobs: new JobService({
      jobStore,
      objects,
      providers: {
        'watermark-removal': provider,
        'background-removal': backgroundProvider,
      },
      benefits,
    }),
  };
}

export function getServices() {
  return (cached ??= createServices());
}
import { Pool } from 'pg';
import { PostgresBenefitStore } from './benefits/postgres-benefit-store';
