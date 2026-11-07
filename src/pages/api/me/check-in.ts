import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { json } from '../../../lib/api/response';
import { getAccountServices } from '../../../lib/services';
import { creditsContractVersion } from '../../../lib/contracts/credits-client';
import { ProcessingError } from '../../../lib/processing/contracts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user.id) return json({ error: 'Sign in with Google to check in.' }, { status: 401 });
  try {
    return json(await getAccountServices().benefits.checkIn(session.user.id, session.user.email, request.headers.get('X-Credits-Contract') === creditsContractVersion));
  } catch (error) {
    if (error instanceof ProcessingError && error.code === 'wallet_upgraded') return json({ error: 'Refresh the workspace to claim Credits rewards.', code: 'wallet_upgraded' }, { status: 409 });
    return json({ error: 'Daily check-in is temporarily unavailable.' }, { status: 503 });
  }
};
