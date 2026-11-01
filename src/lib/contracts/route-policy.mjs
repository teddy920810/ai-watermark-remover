/** Route ownership is independent of visibility and indexing. No server configuration. */
export const reservedToolSlugs = new Set(['api', 'app', 'auth', 'blog', 'pricing', 'privacy', 'terms', '404', 'robots', 'sitemap', 'robots.txt', 'sitemap.xml']);
export const knownPageRoutes = ['/', '/blog', '/privacy', '/terms', '/pricing', '/app', '/app/image', '/app/video', '/app/credits'];
export const normalizeRoute = value => (value.split(/[?#]/)[0].replace(/\/$/, '') || '/');
export const isPrivateRoute = value => /^\/(?:api(?:\/|$)|app(?:\/|$)|auth(?:\/|$))/.test(value);
export const isAppOwnedRoute = value => value === '/pricing' || value === '/pricing/' || /^\/(?:api(?:\/|$)|app(?:\/|$)|auth\/popup$)/.test(value);
export function routePolicy(value) {
  const pathname = normalizeRoute(value);
  const asset = /^\/(?:_(?:app|site)-assets|_astro|uploads|images)(?:\/|$)/.test(pathname);
  return { owner: pathname.startsWith('/_app-assets/') || isAppOwnedRoute(pathname) ? 'app' : 'site', kind: asset ? 'asset' : pathname.startsWith('/api/') || pathname === '/api' ? 'api' : isPrivateRoute(pathname) ? 'private-page' : 'public-page', private: isPrivateRoute(pathname), indexable: !asset && !isPrivateRoute(pathname) && pathname !== '/404' };
}
