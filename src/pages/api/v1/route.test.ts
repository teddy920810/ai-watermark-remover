import { describe, expect, it, vi } from 'vitest';
const { handleServerProcessingRequest } = vi.hoisted(() => ({ handleServerProcessingRequest: vi.fn(async () => new Response('{}', { status: 202 })) }));
vi.mock('../../../lib/runtime/server-processing-runtime', () => ({ handleServerProcessingRequest }));
import { GET, POST, ALL, prerender } from './[...path]';
describe('processing v1 Astro route', () => {
  it('delegates both request methods without reading authentication or server configuration at import', async () => {
    expect(prerender).toBe(false);
    for (const route of [GET, POST, ALL]) { const request = new Request('https://www.test/api/v1/jobs'); expect((await route({ request } as never)).status).toBe(202); expect(handleServerProcessingRequest).toHaveBeenLastCalledWith(request); }
  });
});
