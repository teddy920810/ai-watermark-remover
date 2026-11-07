import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { json } from '../../../lib/api/response';
import { getAccountServices } from '../../../lib/services';
import { creditsContractVersion } from '../../../lib/contracts/credits-client';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user.id) return json({ error: 'Sign in with Google to view free uses.' }, { status: 401 });
  try {
    const services = getAccountServices();
    await services.recoverUser(session.user.id);
    const summary = await services.benefits.getSummary(session.user.id, session.user.email);
    if (summary.walletMode === 'unified' && request.headers.get('X-Credits-Contract') !== creditsContractVersion) return json({ error: 'Refresh the workspace to use your Credits account.', code: 'wallet_upgraded' }, { status: 409 });
    return json(summary);
  } catch {
    return json({ error: 'Free-use balance is temporarily unavailable.' }, { status: 503 });
  }
};
