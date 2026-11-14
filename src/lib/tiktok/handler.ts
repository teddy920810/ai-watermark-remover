import { json } from '../api/response';
import { readBoundedBody, RequestBodyLimitError } from '../api/request-body';
import { resolverOperationCatalog } from '../contracts/operation-catalog';
import { normalizeTikTokUrl, resolveTikTok } from './resolver';
import type { TikTokAdmission } from './admission';

/** Local previews use process protection; production additionally requires shared admission. */
export function createTikTokHandler(enabled: boolean, fetcher: typeof fetch = fetch, options: { localOnly?: boolean; admission?: TikTokAdmission } = {}) {
  let active = false, lastStarted = 0;
  return async (request: Request) => {
    if (!enabled) return json({ error: 'Not found' }, { status: 404 });
    const url = new URL(request.url);
    const localOnly = options.localOnly ?? true;
    if (request.headers.get('origin') !== url.origin || (localOnly ? !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) : url.protocol !== 'https:')) return json({ error: 'Open this tool on the same website and try again.' }, { status: 403 });
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'JSON input is required.' }, { status: 415 });
    let input: string;
    try {
      const bytes = await readBoundedBody(request.body, resolverOperationCatalog['tiktok-video-resolve'].maxInputBytes);
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (body?.operation !== 'tiktok-video-resolve') throw new Error('Invalid operation.');
      input = normalizeTikTokUrl(body.url);
    } catch (error) {
      return json({ error: error instanceof RequestBodyLimitError ? 'The link is too long.' : error instanceof SyntaxError ? 'Enter a valid TikTok video URL.' : error instanceof Error ? error.message : 'Invalid input.' }, { status: error instanceof RequestBodyLimitError ? 413 : 400 });
    }
    const policy = resolverOperationCatalog['tiktok-video-resolve'];
    if (active || Date.now() - lastStarted < policy.minIntervalMs) return json({ error: 'Please wait a moment before trying again.' }, { status: 429, headers: { 'Retry-After': '2' } });
    let lease: string | null = null;
    try {
      if (!localOnly && !options.admission) throw new Error('Admission unavailable');
      if (options.admission) {
        lease = await options.admission.acquire();
        if (!lease) return json({ error: 'The video tool is busy or has reached its daily limit. Please try later.' }, { status: 429, headers: { 'Retry-After': '30' } });
      }
    } catch { return json({ error: 'The video tool is temporarily unavailable. Please try later.' }, { status: 503 }); }
    active = true; lastStarted = Date.now();
    try { return json(await resolveTikTok(input, fetcher)); }
    catch { return json({ error: 'We could not resolve this video. Check that it is public, then try again.' }, { status: 502 }); }
    finally { active = false; if (lease) await options.admission!.release(lease).catch(() => {}); }
  };
}
