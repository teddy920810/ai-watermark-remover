import { Pool } from 'pg';
import { z } from 'zod';
import { getServerEnv } from './config/server-env';
import { PostgresBenefitStore } from './benefits/postgres-benefit-store';
import { JobService } from './jobs/job-service';
import { R2JobStore } from './jobs/r2-job-store';
import { DewatermarkProvider } from './providers/dewatermark-provider';
import { MockWatermarkProvider } from './providers/mock-provider';
import { MockBackgroundProvider } from './providers/mock-background-provider';
import { ReplicateBackgroundProvider } from './providers/replicate-background-provider';
import { MockObjectProvider } from './providers/mock-object-provider';
import { ReplicateObjectProvider } from './providers/replicate-object-provider';
import type { LegacyWatermarkProvider } from './providers/watermark-provider';
import { R2ObjectStore } from './r2/r2-object-store';
import { getPaymentConfig } from './payments/payment-config';
import { PostgresJobRequestStore } from './jobs/postgres-job-request-store';

let cached: ReturnType<typeof createServices> | undefined;
let cachedAccounts: AccountServices | undefined;

interface AccountServices {
  pool: Pool;
  benefits: PostgresBenefitStore;
  requests?: PostgresJobRequestStore;
  recoverUser(userId: string): Promise<void>;
}

function createAccountServices(): AccountServices {
  const databaseUrl = z.url().parse(process.env.DATABASE_URL);
  const paymentConfig = getPaymentConfig();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  const benefits = new PostgresBenefitStore(pool, paymentConfig.creditsEnabled, paymentConfig.environment, paymentConfig.imageCosts, paymentConfig.creditsEnabled ? paymentConfig.imageCostVersion : undefined);
  const requests = paymentConfig.creditsEnabled ? new PostgresJobRequestStore(pool, paymentConfig.environment) : undefined;
  return {
    pool,
    benefits,
    requests,
    async recoverUser(userId) {
      if (!requests) return;
      const candidates = await requests.recoverable(userId);
      if (candidates.length === 0) return;
      // A balance with no pending settlement needs only Postgres. Actual job
      // recovery still requires the media services and must fail if unavailable.
      await getServices().jobs.recoverUser(userId);
    },
  };
}

export function getAccountServices(): AccountServices {
  return (cachedAccounts ??= createAccountServices());
}

function createServices() {
  const env = getServerEnv();
  const objects = new R2ObjectStore({
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
  const jobStore = new R2JobStore(objects);
  const { benefits, requests } = getAccountServices();
  const provider: LegacyWatermarkProvider = env.WATERMARK_PROVIDER === 'dewatermark'
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
  const objectProvider = env.OBJECT_REMOVAL_PROVIDER === 'replicate'
    ? new ReplicateObjectProvider(objects, {
        apiToken: env.REPLICATE_API_TOKEN as string,
        baseUrl: env.REPLICATE_BASE_URL,
        modelVersion: env.REPLICATE_LAMA_MODEL_VERSION,
        timeoutMs: env.REPLICATE_TIMEOUT_MS,
        waitSeconds: env.REPLICATE_WAIT_SECONDS,
      })
    : new MockObjectProvider(objects, env.MOCK_PROCESSING_DELAY_MS);
  return {
    objects,
    benefits,
    jobs: new JobService({
      jobStore,
      objects,
      providers: {
        'watermark-removal': provider,
        'background-removal': backgroundProvider,
        'object-removal': objectProvider,
      },
      benefits,
      ...(requests ? { requests } : {}),
    }),
  };
}

export function getServices() {
  return (cached ??= createServices());
}
