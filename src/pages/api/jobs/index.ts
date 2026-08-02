import type { APIRoute } from 'astro';
import { parseCreateJob } from '../../../lib/api/contracts';
import { json, readJson } from '../../../lib/api/response';
import { getServices } from '../../../lib/services';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { inputKey } = parseCreateJob(await readJson(request));
    const job = await getServices().jobs.create(inputKey);
    return json({ id: job.id, status: job.status }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create job';
    const status = message === 'Upload not found' ? 404 : 400;
    return json({ error: message }, { status });
  }
};
