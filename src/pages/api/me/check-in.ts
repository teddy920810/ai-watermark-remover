import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { json } from '../../../lib/api/response';
import { getServices } from '../../../lib/services';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user.id) return json({ error: 'Sign in with Google to check in.' }, { status: 401 });
  try {
    return json(await getServices().benefits.checkIn(session.user.id));
  } catch {
    return json({ error: 'Daily check-in is temporarily unavailable.' }, { status: 503 });
  }
};
