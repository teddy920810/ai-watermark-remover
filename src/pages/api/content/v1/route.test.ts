import { describe, expect, it, vi } from 'vitest';
const { handleContentRequest } = vi.hoisted(() => ({ handleContentRequest: vi.fn(async () => new Response('{}', { status: 401 })) }));
vi.mock('../../../../lib/content-api/server', () => ({ handleContentRequest }));
import { ALL, prerender } from './[...path]';
describe('content API server boundary', () => {
  it('delegates methods to the content-only server without loading user sessions or Provider configuration', async () => {
    expect(prerender).toBe(false);
    const request = new Request('https://www.watermarkgemini.com/api/content/v1/schema');
    expect((await ALL({ request } as never)).status).toBe(401); expect(handleContentRequest).toHaveBeenCalledWith(request);
  });
});
