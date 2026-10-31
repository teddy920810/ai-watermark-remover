import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../lib/auth', () => ({ getSession: vi.fn() }));
import { GET } from './catalog';

afterEach(() => vi.unstubAllEnvs());

it('publishes operation credit costs and version without credentials while Live checkout is paused', async () => {
  vi.stubEnv('PAYPAL_ENABLED', 'false');
  vi.stubEnv('PAYPAL_CREDITS_ENABLED', 'true');
  vi.stubEnv('PAYPAL_ENVIRONMENT', 'live');
  vi.stubEnv('PAYPAL_IMAGE_COSTS_JSON', JSON.stringify({ 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 }));
  vi.stubEnv('PAYPAL_IMAGE_COST_VERSION', 'image-costs-v2');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'private-test-secret');
  const response = await GET({} as Parameters<typeof GET>[0]);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ enabled: false, creditsEnabled: true, imageCosts: { 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 }, imageCostVersion: 'image-costs-v2' });
  expect(JSON.stringify(body)).not.toContain('private-test-secret');
  expect(body).not.toHaveProperty('clientId');
});
it('explicitly publishes creditsEnabled=false for the unchanged free-only flow', async () => {
  vi.stubEnv('PAYPAL_ENABLED', 'false');
  vi.stubEnv('PAYPAL_CREDITS_ENABLED', 'false');
  const response = await GET({} as Parameters<typeof GET>[0]);
  expect(await response.json()).toMatchObject({ enabled: false, creditsEnabled: false });
});
