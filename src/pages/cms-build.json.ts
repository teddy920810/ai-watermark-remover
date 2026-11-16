/** Public static deployment identity; contains no draft content or credentials. */
export const prerender = true;
export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';
  const revision = /^[a-f0-9]{40}$/.test(sha) ? sha : null;
  return new Response(JSON.stringify({ revision }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Robots-Tag': 'noindex' } });
}
