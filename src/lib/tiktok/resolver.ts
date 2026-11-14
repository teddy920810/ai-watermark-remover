import { readBoundedBody } from '../api/request-body';
import { resolverOperationCatalog } from '../contracts/operation-catalog';
import { decodeTikmateResponse, extractTikmateResult } from './tikmate-response';

export function normalizeTikTokUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > resolverOperationCatalog['tiktok-video-resolve'].maxUrlLength) throw new Error('Enter a full TikTok video URL.');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a valid TikTok video URL.'); }
  if (['vt.tiktok.com', 'vm.tiktok.com'].includes(url.hostname)) throw new Error('Short links are not supported yet. Paste the full TikTok video URL.');
  if (url.protocol !== 'https:' || url.hostname !== 'www.tiktok.com' || url.username || url.password || url.port || !/^\/@[\w.-]+\/video\/\d{15,22}\/?$/.test(url.pathname)) throw new Error('Use a full https://www.tiktok.com/@user/video/… link.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

export async function resolveTikTok(input: unknown, fetcher: typeof fetch = fetch) {
  const url = normalizeTikTokUrl(input);
  const policy = resolverOperationCatalog['tiktok-video-resolve'];
  const signal = AbortSignal.timeout(policy.timeoutMs);
  async function text(response: Response) {
    if (!response.ok) { await response.body?.cancel(); throw new Error('Provider unavailable'); }
    return new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBody(response.body, policy.maxResponseBytes));
  }
  // Observed form contract: https://tikmate.io/ (M1). Fixed endpoints only;
  // input URLs and returned media URLs are never fetched by this server.
  const home = await fetcher('https://tikmate.io/', { signal, redirect: 'error' });
  const html = await text(home);
  const token = html.match(/name="token"\s+value="([^"]+)"/)?.[1];
  if (!token) throw new Error('Provider form changed');
  const cookies = home.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const response = await fetcher('https://tikmate.io/abc.php', { method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://tikmate.io', Referer: 'https://tikmate.io/', ...(cookies ? { Cookie: cookies } : {}) },
    body: new URLSearchParams({ url, token }),
  });
  return { operation: 'tiktok-video-resolve' as const, ...extractTikmateResult(decodeTikmateResponse(await text(response))) };
}
export type TikTokResult = Awaited<ReturnType<typeof resolveTikTok>>;
