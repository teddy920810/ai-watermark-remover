import { resolverOperationCatalog } from '../contracts/operation-catalog';

const maxLength = resolverOperationCatalog['tiktok-video-resolve'].maxUrlLength;

/** Fragments stay in the browser rather than the document request or referrer. */
export function tikTokLaunchHash(input: string) {
  const value = input.trim();
  if (!value || value.length > maxLength) throw new Error('Paste a TikTok video link.');
  return `#tiktok=${encodeURIComponent(value)}`;
}

export function consumeTikTokLaunch(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'state' | 'replaceState'>) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('tiktok')) return null;
  // Consume before starting a request: reload/back must not repeat a launch.
  history.replaceState(history.state, '', location.pathname + location.search);
  const value = params.get('tiktok')?.trim();
  return value && value.length <= maxLength ? value : null;
}
