import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parseCreateJob } from '../../../lib/api/contracts';
import { publicApiError } from '../../../lib/api/error';
import { json, readJson } from '../../../lib/api/response';
import { getServices } from '../../../lib/services';
import { ImagePriceChangedError, type ImageCreditConsent } from '../../../lib/benefits/benefit-store';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user.id) {
    return json({ error: 'Sign in with Google to process this upload.' }, { status: 401 });
  }

  let inputKey: string;
  let maskKey: string | undefined;
  let operation: 'watermark-removal' | 'background-removal' | 'object-removal';
  let imageCreditConsent: ImageCreditConsent | undefined;
  try {
    ({ inputKey, maskKey, operation, imageCreditConsent } = parseCreateJob(await readJson(request)));
  } catch {
    return json({ error: 'Invalid job request.' }, { status: 400 });
  }

  try {
    const jobs = getServices().jobs;
    const job = imageCreditConsent
      ? await jobs.create(inputKey, session.user.id, operation, maskKey, imageCreditConsent)
      : maskKey ? await jobs.create(inputKey, session.user.id, operation, maskKey) : await jobs.create(inputKey, session.user.id, operation);
    return json({ id: job.id, status: job.status }, { status: 201 });
  } catch (error) {
    if (error instanceof ImagePriceChangedError) return json({ error: 'Review the current image credit price and confirm again.', code: 'image_price_changed' }, { status: 409 });
    const message = publicApiError(error, 'Unable to create job', ['Upload not found', 'Mask not found', 'Invalid uploaded image', 'Invalid mask image', 'No free uses remaining']);
    const status = message === 'Upload not found' || message === 'Mask not found' ? 404 : message === 'Invalid uploaded image' || message === 'Invalid mask image' ? 400 : message === 'No free uses remaining' ? 402 : 503;
    return json({ error: message }, { status });
  }
};
