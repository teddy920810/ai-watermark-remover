import type { APIRoute } from 'astro';
import { handleServerProcessingRequest } from '../../../lib/runtime/server-processing-runtime';

export const prerender = false;
export const ALL: APIRoute = ({ request }) => handleServerProcessingRequest(request);
export const GET = ALL;
export const POST = ALL;
