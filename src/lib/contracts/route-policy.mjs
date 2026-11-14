/** Route ownership is independent of visibility and indexing. No server configuration. */
export const reservedToolSlugs = new Set(['api', 'app', 'auth', 'blog', 'pricing', 'privacy', 'terms', '404', 'robots', 'sitemap', 'robots.txt', 'sitemap.xml']);
export const knownPageRoutes = ['/', '/blog', '/privacy', '/terms', '/pricing', '/app', '/app/image', '/app/video', '/app/free/gemini', '/app/free/tiktok', '/app/credits'];
export const normalizeRoute = value => (value.split(/[?#]/)[0].replace(/\/$/, '') || '/');
// Explicit entry registration: additional Gemini pages may share this workspace
// without inheriting a route from a keyword or changing their public upload UI.
const toolWorkspaces = new Map([['/gemini-watermark-remover', '/app/free/gemini']]);
export const toolWorkspaceForSource = source => toolWorkspaces.get(normalizeRoute(`/${source.replace(/^\/+/, '')}`)) ?? null;
// Link intake is separate from file handoff and uses the existing TikTok landing.
export const linkToolWorkspaceForSource = source => normalizeRoute(`/${source.replace(/^\/+/, '')}`) === '/tiktok-watermark-remover' ? '/app/free/tiktok' : null;
export const isPrivateRoute = value => /^\/(?:api(?:\/|$)|app(?:\/|$)|auth(?:\/|$))/.test(value);
export const isAppOwnedRoute = value => value === '/pricing' || value === '/pricing/' || /^\/(?:api(?:\/|$)|app(?:\/|$)|auth\/popup$)/.test(value);
export function routePolicy(value) {
  const pathname = normalizeRoute(value);
  const asset = /^\/(?:_(?:app|site)-assets|_astro|uploads|images)(?:\/|$)/.test(pathname);
  return { owner: pathname.startsWith('/_app-assets/') || isAppOwnedRoute(pathname) ? 'app' : 'site', kind: asset ? 'asset' : pathname.startsWith('/api/') || pathname === '/api' ? 'api' : isPrivateRoute(pathname) ? 'private-page' : 'public-page', private: isPrivateRoute(pathname), indexable: !asset && !isPrivateRoute(pathname) && pathname !== '/404' };
}
