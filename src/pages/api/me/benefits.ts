import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { json } from '../../../lib/api/response';
import { getAccountServices } from '../../../lib/services';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user.id) return json({ error: 'Sign in with Google to view free uses.' }, { status: 401 });
  try {
    const services = getAccountServices();
    await services.recoverUser(session.user.id);
    return json(await services.benefits.getSummary(session.user.id, session.user.email));
  } catch {
    return json({ error: 'Free-use balance is temporarily unavailable.' }, { status: 503 });
  }
};
