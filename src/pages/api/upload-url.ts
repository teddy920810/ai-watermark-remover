import type { APIRoute } from 'astro';
import { getSession } from '../../lib/auth';
import { parseUploadRequest } from '../../lib/api/contracts';
import { publicApiError } from '../../lib/api/error';
import { json, readJson } from '../../lib/api/response';
import { getServices } from '../../lib/services';
import { createUploadKey } from '../../lib/upload/upload-key';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user.id) {
    return json({ error: 'Sign in with Google to upload an image.' }, { status: 401 });
  }

  let input: ReturnType<typeof parseUploadRequest>;
  try {
    input = parseUploadRequest(await readJson(request));
  } catch {
    return json({ error: 'Invalid upload request.' }, { status: 400 });
  }

  try {
    const key = createUploadKey(input.contentType, session.user.id);
    const url = await getServices().objects.createUploadUrl(key, input.contentType);
    return json({ url, key, expiresIn: 600 });
  } catch (error) {
    const message = publicApiError(error, 'Upload service is temporarily unavailable.');
    return json({ error: message }, { status: 503 });
  }
};
