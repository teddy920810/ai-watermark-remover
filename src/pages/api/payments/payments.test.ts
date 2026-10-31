import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getSession, getPaymentService } = vi.hoisted(() => ({ getSession: vi.fn(), getPaymentService: vi.fn() }));
vi.mock('../../../lib/auth', () => ({ getSession }));
vi.mock('../../../lib/payments/payment-services', () => ({ getPaymentService }));
import { POST as create } from './paypal/orders';
import { POST as capture } from './paypal/orders/[id]/capture';
import { POST as webhook } from './paypal/webhook';
import { GET as list } from './orders';
import { GET as refresh } from './orders/[id]';

const id = '00000000-0000-4000-8000-000000000001';
const order = { id, userId: 'user-1', requestKey: 'private-key', sku: 'starter', credits: 5, amountCents: 499, currency: 'USD', status: 'created', createdAt: '2026-10-25T00:00:00Z', paypalOrderId: 'PP1' };
function context(body: unknown = { sku: 'starter' }, origin: string | null = 'https://site.test') {
  return { params: { id }, request: new Request('https://site.test/api/payments/paypal/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }) } as unknown as Parameters<typeof create>[0];
}
describe('authenticated payment routes', () => {
  let service: { create: ReturnType<typeof vi.fn>; capture: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; webhook: ReturnType<typeof vi.fn> };
  beforeEach(() => { getSession.mockReset().mockResolvedValue({ user: { id: 'user-1' } }); service = { create: vi.fn().mockResolvedValue(order), capture: vi.fn().mockResolvedValue(order), list: vi.fn().mockResolvedValue([order]), refresh: vi.fn().mockResolvedValue(order), webhook: vi.fn() }; getPaymentService.mockReset().mockReturnValue(service); });
  it('requires sign in and checks Origin before creating or capturing payments', async () => {
    getSession.mockResolvedValue(null); expect((await create(context())).status).toBe(401);
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    expect((await create(context(undefined, 'https://evil.test'))).status).toBe(403);
    expect((await capture(context({}, null))).status).toBe(403);
    expect(service.create).not.toHaveBeenCalled(); expect(service.capture).not.toHaveBeenCalled();
  });
  it('accepts only a server-known SKU and UUID request key, never user supplied amounts or owner', async () => {
    expect((await create(context({ sku: 'starter', amountCents: 1 }))).status).toBe(400);
    const invalid = context(); invalid.request.headers.set('Idempotency-Key', '');
    expect((await create(invalid)).status).toBe(400);
    const response = await create(context()); expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith('user-1', 'starter', id);
    expect(await response.text()).not.toContain('private-key');
  });
  it('validates path ids and safely captures the authenticated order', async () => {
    const invalid = context({}); invalid.params.id = '../another';
    expect((await capture(invalid)).status).toBe(400);
    expect((await capture(context({}))).status).toBe(200);
    expect(service.capture).toHaveBeenCalledWith('user-1', id);
  });
  it('rejects cross-site signals, malformed capture payloads and oversized create requests before provider calls', async () => {
    const crossSite = context(); crossSite.request.headers.set('Sec-Fetch-Site', 'cross-site');
    expect((await create(crossSite)).status).toBe(403);
    expect((await capture(context({ amountCents: 1 }))).status).toBe(400);
    expect((await create(context({ sku: 'x'.repeat(5000) }))).status).toBe(413);
    const wrongType = context(); wrongType.request.headers.set('Content-Type', 'text/plain');
    expect((await create(wrongType)).status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.capture).not.toHaveBeenCalled();
  });
  it('lists only the signed in account and rechecks existing orders for recovery', async () => {
    expect((await list(context())).status).toBe(200);
    expect(service.list).toHaveBeenCalledWith('user-1');
    expect((await refresh(context())).status).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith('user-1', id);
    service.refresh.mockRejectedValue(new Error('postgres://secret'));
    const response = await refresh(context()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('postgres');
  });
  it('passes signed webhook headers/body without requiring buyer login and returns failure for retry', async () => {
    getSession.mockResolvedValue(null);
    const ctx = context({ id: 'EV1' });
    expect((await webhook(ctx)).status).toBe(200);
    expect(service.webhook).toHaveBeenCalledWith(ctx.request.headers, { id: 'EV1' });
    service.webhook.mockRejectedValue(new Error('db failure'));
    expect((await webhook(context({ id: 'EV2' }))).status).toBe(503);
  });
});
