import type { APIRoute } from 'astro';
import { handleContentRequest } from '../../../../lib/content-api/server';
export const prerender = false;
export const ALL: APIRoute = ({ request }) => handleContentRequest(request);
