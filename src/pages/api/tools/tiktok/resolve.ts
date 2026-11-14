import type { APIRoute } from 'astro';
import { createTikTokHandler } from '../../../../lib/tiktok/handler';
import { createTikTokAdmission } from '../../../../lib/tiktok/admission';
import { getWebDatabasePool } from '../../../../lib/runtime/web-database-pool';
export const prerender = false;
const handle = createTikTokHandler(true, fetch, { localOnly: import.meta.env.DEV,
  admission: !import.meta.env.DEV && process.env.DATABASE_URL ? createTikTokAdmission(getWebDatabasePool(process.env.DATABASE_URL)) : undefined,
});
export const POST: APIRoute = ({ request }) => handle(request);
