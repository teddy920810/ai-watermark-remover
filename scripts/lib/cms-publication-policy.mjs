import { knownPageRoutes, reservedToolSlugs } from '../../src/lib/contracts/route-policy.mjs';
export function collectPublicationIssues(records, assetExists) {
  const issues = [];
  const seen = new Set();
  const publicRoutes = new Set(knownPageRoutes);
  for (const record of records) {
    const landing = record.path.startsWith('src/content/landing-pages/');
    const route = `${landing ? '' : '/blog'}/${record.data.slug}`;
    if (seen.has(route)) issues.push(`${record.path}: duplicate / 重复 URL ${route}.`);
    seen.add(route);
    if (landing && reservedToolSlugs.has(record.data.slug)) issues.push(`${record.path}: reserved / 保留 URL ${route}.`);
    if (record.data.draft !== true) publicRoutes.add(route);
  }
  const checkString = (text, record) => {
    if (text.includes('【待替换】') || text.includes('/images/image-placeholder.svg')) {
      issues.push(`${record.path}: 发布前请替换所有【待替换】内容和模板占位图片，或保持草稿开启。`);
    }
    // Check local links/assets without contacting external services.
    const links = [...text.matchAll(/(?:\]\(|(?:href|src)=["'])(\/[^\s)"']+)/g)].map((match) => match[1]);
    if (text.startsWith('/') && !text.startsWith('//') && !/\s/.test(text)) links.push(text);
    for (const link of links) {
      const pathname = link.split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (pathname.startsWith('/uploads/') || pathname.startsWith('/images/')) {
        // Preserve the established image fallback for legacy operations content.
        if (record.data.templateVersion === 1 && assetExists && !assetExists(pathname)) issues.push(`${record.path}: 图片不存在 ${pathname}.`);
      } else if (!publicRoutes.has(pathname) && !pathname.startsWith('/api/')) {
        issues.push(`${record.path}: 链接不是已发布页面 ${pathname}.`);
      }
    }
  };
  const visit = (value, record) => {
    if (typeof value === 'string') checkString(value, record);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, record));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => visit(item, record));
  };
  for (const record of records) {
    if (record.data.draft === true) continue;
    visit(record.data, record);
    checkString(record.body ?? '', record);
  }
  return [...new Set(issues)];
}

