import type { APIRoute } from 'astro';
import { parseCreateJob } from '../../../lib/api/contracts';
import { publicApiError } from '../../../lib/api/error';
import { json, readJson } from '../../../lib/api/response';
import { getServices } from '../../../lib/services';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let inputKey: string;
  try {
    ({ inputKey } = parseCreateJob(await readJson(request)));
  } catch {
    return json({ error: 'Invalid job request.' }, { status: 400 });
  }

  try {
    const job = await getServices().jobs.create(inputKey);
    return json({ id: job.id, status: job.status }, { status: 201 });
  } catch (error) {
    const message = publicApiError(error, 'Unable to create job', ['Upload not found']);
    const status = message === 'Upload not found' ? 404 : 503;
    return json({ error: message }, { status });
  }
};
