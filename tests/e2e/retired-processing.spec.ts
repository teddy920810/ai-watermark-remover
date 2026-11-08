import { test, expect } from '@playwright/test';

for (const path of ['/api/upload-url', '/api/jobs', '/api/jobs/retired-job']) {
  test(`retired processing endpoint ${path} cannot admit or restore a job`, async ({ request }) => {
    for (const method of ['GET', 'POST'] as const) {
      const response = await request.fetch(path, { method, headers: { Origin: 'http://127.0.0.1:4379', 'Content-Type': 'application/json' }, data: method === 'POST' ? {} : undefined });
      expect(response.status()).toBe(404);
      expect(response.headers()['set-cookie']).toBeUndefined();
    }
  });
}
