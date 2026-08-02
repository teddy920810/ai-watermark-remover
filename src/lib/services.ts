import { getServerEnv } from './config/server-env';
import { JobService } from './jobs/job-service';
import { R2JobStore } from './jobs/r2-job-store';
import { MockWatermarkProvider } from './providers/mock-provider';
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
  const provider = new MockWatermarkProvider(objects, env.MOCK_PROCESSING_DELAY_MS);
  return { objects, jobs: new JobService({ jobStore, objects, provider }) };
}

export function getServices() {
  return (cached ??= createServices());
}
