import type { APIRoute } from 'astro';
import { parseUploadRequest } from '../../lib/api/contracts';
import { json, readJson } from '../../lib/api/response';
import { getServices } from '../../lib/services';
import { createUploadKey } from '../../lib/upload/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = parseUploadRequest(await readJson(request));
    const key = createUploadKey(input.contentType);
    const url = await getServices().objects.createUploadUrl(key, input.contentType);
    return json({ url, key, expiresIn: 600 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid upload request';
    return json({ error: message }, { status: 400 });
  }
};
