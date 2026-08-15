import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildSitemapEntries, renderSitemapXml } from '../lib/content/sitemap';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('Astro site URL is required to generate sitemap.xml.');
  const [posts, landingPages] = await Promise.all([
    getCollection('blog'),
    getCollection('landingPages'),
  ]);
  const entries = buildSitemapEntries({
    posts: posts.map(({ data }) => data),
    landingPages: landingPages.map(({ data }) => data),
  });

  return new Response(renderSitemapXml(site, entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

