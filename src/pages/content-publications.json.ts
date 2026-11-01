import { buildPublications } from '../lib/content-api/publication';
export const prerender = true;
export function GET() {
  const records = Object.values(import.meta.glob('../../.content-api/*.json', { eager: true, import: 'default' }));
  return new Response(JSON.stringify(buildPublications(records)), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Robots-Tag': 'noindex' } });
}
