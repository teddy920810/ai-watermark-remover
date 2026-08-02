import type { APIRoute } from 'astro';
import { publicApiError } from '../../../lib/api/error';
import { json } from '../../../lib/api/response';
import { getServices } from '../../../lib/services';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid job ID' }, { status: 400 });

  try {
    const services = getServices();
    const job = await services.jobs.get(id);
    if (!job) return json({ error: 'Job not found' }, { status: 404 });

    if (job.status === 'completed' && job.resultKey) {
      const [resultUrl, downloadUrl] = await Promise.all([
        services.objects.createResultUrl(job.resultKey),
        services.objects.createDownloadUrl(job.resultKey),
      ]);
      return json({ status: job.status, resultUrl, downloadUrl });
    }

    return json({ status: job.status, error: job.error });
  } catch (error) {
    return json({ error: publicApiError(error, 'Job service is temporarily unavailable.') }, { status: 503 });
  }
};
