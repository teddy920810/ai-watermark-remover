const reservedLandingSlugs = new Set(['api', 'auth', 'blog', 'privacy', 'robots.txt', 'sitemap.xml', 'terms']);

function envValue(source, key) {
  return source.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
}

function visitStrings(value, visit) {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => visitStrings(item, visit));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => visitStrings(item, visit));
  }
}

function normalizeRoute(value) {
  const route = value.split(/[?#]/, 1)[0] || '/';
  return route.length > 1 ? route.replace(/\/$/, '') : route;
}

export function collectSiteValidationIssues(input) {
  const issues = [];
  const siteUrl = envValue(input.envExample, 'SITE_URL');
  const authUrl = envValue(input.envExample, 'BETTER_AUTH_URL');
  if (!siteUrl || !authUrl || siteUrl !== authUrl) {
    issues.push('SITE_URL and BETTER_AUTH_URL must use the same non-empty canonical origin.');
  }
  if (!input.canonicalOrigin || input.canonicalOrigin !== siteUrl) {
    issues.push('CMS canonical origin must match SITE_URL exactly.');
  }

  const duplicateLandingSlugs = input.landingSlugs.filter((slug, index, values) => values.indexOf(slug) !== index);
  duplicateLandingSlugs.forEach((slug) => issues.push(`Landing slug ${slug} is duplicated.`));
  input.landingSlugs.forEach((slug) => {
    if (reservedLandingSlugs.has(slug)) issues.push(`Landing slug ${slug} conflicts with reserved route /${slug}.`);
  });
  const duplicateBlogSlugs = input.blogSlugs.filter((slug, index, values) => values.indexOf(slug) !== index);
  duplicateBlogSlugs.forEach((slug) => issues.push(`Blog slug ${slug} is duplicated.`));

  const allowedRoutes = new Set([
    '/', '/blog', '/privacy', '/terms',
    ...input.landingSlugs.map((slug) => `/${slug}`),
    ...input.blogSlugs.map((slug) => `/blog/${slug}`),
  ]);
  const availableAssets = new Set(input.availableAssets);

  input.contentDocuments.forEach((document) => {
    visitStrings(document.value, (value) => {
      if (/https:\/\/github\.com\/[^\s)]+\/blob\/[^\s)]+/i.test(value)) {
        issues.push(`${document.path}: use a public /uploads path instead of a GitHub blob URL.`);
      }

      for (const match of value.matchAll(/\/uploads\/[A-Za-z0-9._/-]+/g)) {
        if (!availableAssets.has(match[0])) issues.push(`${document.path}: referenced asset ${match[0]} does not exist.`);
      }

      const internalLinks = [];
      if (value.startsWith('/') && !value.startsWith('//')) internalLinks.push(value);
      for (const match of value.matchAll(/\]\((\/[^)\s]+)\)/g)) internalLinks.push(match[1]);
      for (const match of value.matchAll(/(?:href|src)=["'](\/[^"']+)["']/gi)) internalLinks.push(match[1]);
      internalLinks.forEach((link) => {
        if (link.startsWith('/uploads/') || link.startsWith('/api/')) return;
        const route = normalizeRoute(link);
        if (!allowedRoutes.has(route)) issues.push(`${document.path}: internal link ${link} does not match a public route.`);
      });
    });
  });

  return [...new Set(issues)].sort();
}
