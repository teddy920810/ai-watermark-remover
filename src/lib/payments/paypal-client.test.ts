import { describe, expect, it, vi } from 'vitest';
import { PayPalClient, PayPalIssueError } from './paypal-client';
import { getPaymentConfig } from './payment-config';

const config = { environment: 'sandbox' as const, clientId: 'public-id', clientSecret: 'private-secret', merchantId: 'MERCHANT1', webhookId: 'WH-1' };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('PayPal server contract', () => {
  it('keeps checkout disabled unless explicitly configured and refuses incomplete/live draft configuration', () => {
    expect(getPaymentConfig({}).enabled).toBe(false);
    expect(() => getPaymentConfig({ PAYPAL_ENABLED: 'true' })).toThrow();
    expect(() => getPaymentConfig({ PAYPAL_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_MERCHANT_ID: 'merchant', PAYPAL_WEBHOOK_ID: 'wh' })).toThrow();
  });
  it('requires live prices, approval and real processing providers, with unique SKUs', () => {
    const source = { PAYPAL_ENABLED: 'true', PAYPAL_ENVIRONMENT: 'live', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_MERCHANT_ID: 'merchant', PAYPAL_WEBHOOK_ID: 'wh', PAYPAL_LIVE_APPROVED: 'true', PAYPAL_CATALOG_VERSION: 'test-approved-v1', PAYPAL_CATALOG_JSON: JSON.stringify([{ sku: 'approved', name: 'Approved', credits: 5, amountCents: 499, currency: 'USD' }]) };
    expect(() => getPaymentConfig(source)).toThrow('real processing providers');
    expect(getPaymentConfig({ ...source, WATERMARK_PROVIDER: 'dewatermark', DEWATERMARK_API_KEY: 'key', REPLICATE_API_TOKEN: 'token', PROCESSING_ENABLED: 'true', PROCESSING_PROVIDER: 'dewatermark', GOOGLE_CLOUD_PROJECT: 'test-project', CLOUD_RUN_REGION: 'asia-east1', CLOUD_RUN_JOB: 'test-worker', PAYPAL_IMAGE_COSTS_JSON: JSON.stringify({ 'watermark-removal': 120, 'background-removal': 230, 'object-removal': 340 }), PAYPAL_IMAGE_COST_VERSION: 'image-costs-v2' }).enabled).toBe(true);
    expect(() => getPaymentConfig({ PAYPAL_CATALOG_JSON: JSON.stringify([{ sku: 'a', name: 'A', credits: 1, amountCents: 100, currency: 'USD' }, { sku: 'a', name: 'B', credits: 2, amountCents: 200, currency: 'USD' }]) })).toThrow('Duplicate');
  });

  it('creates a server-priced digital order with a stable provider request id, no shipping and expected merchant', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ access_token: 'access', expires_in: 3600 })).mockResolvedValueOnce(ok({ id: 'PPORDER1', status: 'CREATED' }));
    const client = new PayPalClient(config, fetcher);
    await client.createOrder({ id: 'local-1', sku: 'starter', amountCents: 499, currency: 'USD', credits: 5 });
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(init.headers['PayPal-Request-Id']).toBe('create-local-1');
    expect(JSON.parse(init.body)).toMatchObject({ intent: 'CAPTURE', purchase_units: [{ reference_id: 'local-1', custom_id: 'local-1', invoice_id: 'local-1', payee: { merchant_id: 'MERCHANT1' }, amount: { currency_code: 'USD', value: '4.99' }, items: [{ category: 'DIGITAL_GOODS' }] }], payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING' } } } });
    expect(JSON.stringify(init)).not.toContain('private-secret');
  });

  it('captures only on the fixed live host using an independent stable request id', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ access_token: 'access', expires_in: 3600 })).mockResolvedValueOnce(ok({ id: 'PPORDER1', status: 'COMPLETED' }));
    await new PayPalClient({ ...config, environment: 'live' }, fetcher).captureOrder('PPORDER1', 'local-1');
    expect(fetcher.mock.calls[1][0]).toBe('https://api-m.paypal.com/v2/checkout/orders/PPORDER1/capture');
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ 'PayPal-Request-Id': 'capture-local-1', Prefer: 'return=representation' });
  });
  it.each([
    ['getOrder', '/v2/checkout/orders/RESOURCE1'],
    ['getCapture', '/v2/payments/captures/RESOURCE1'],
    ['getRefund', '/v2/payments/refunds/RESOURCE1'],
  ] as const)('uses Live credentials and the fixed production host for %s reconciliation', async (method, path) => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ access_token: 'live-access', expires_in: 3600 })).mockResolvedValueOnce(ok({ id: 'RESOURCE1' }));
    const client = new PayPalClient({ ...config, environment: 'live' }, fetcher);
    await client[method]('RESOURCE1');
    expect(fetcher.mock.calls[0][0]).toBe('https://api-m.paypal.com/v1/oauth2/token');
    expect(fetcher.mock.calls[1][0]).toBe(`https://api-m.paypal.com${path}`);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer live-access');
    expect(JSON.stringify(fetcher.mock.calls[1])).not.toContain('private-secret');
  });

  it('verifies all signature metadata through PayPal and accepts only SUCCESS', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ access_token: 'access', expires_in: 3600 })).mockResolvedValueOnce(ok({ verification_status: 'SUCCESS' }));
    const headers = new Headers({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1', 'paypal-transmission-id': 'transmission', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-10-25T00:00:00Z' });
    const event = { id: 'EV1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE1' } };
    expect(await new PayPalClient(config, fetcher).verifyWebhook(headers, event)).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ auth_algo: 'SHA256withRSA', cert_url: headers.get('paypal-cert-url'), transmission_id: 'transmission', transmission_sig: 'sig', transmission_time: '2026-10-25T00:00:00Z', webhook_id: 'WH-1', webhook_event: event });
  });

  it('rejects missing headers, non-PayPal certificate URLs, invalid resource ids and upstream errors without exposing credentials', async () => {
    const fetcher = vi.fn();
    const client = new PayPalClient(config, fetcher);
    expect(await client.verifyWebhook(new Headers(), {})).toBe(false);
    await expect(client.getOrder('../oauth2/token')).rejects.toThrow('Invalid PayPal resource');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response('private-secret', { status: 401 }));
    await expect(client.getOrder('ORDER1')).rejects.toThrow('PayPal is temporarily unavailable');
  });
  it('returns only a safe funding issue code and keeps unknown provider response details private', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ access_token: 'access', expires_in: 3600 })).mockResolvedValueOnce(new Response(JSON.stringify({ details: [{ issue: 'INSTRUMENT_DECLINED', description: 'private payer data' }] }), { status: 422 })).mockResolvedValueOnce(new Response(JSON.stringify({ details: [{ issue: 'PRIVATE_PROVIDER_DIAGNOSTIC' }] }), { status: 422 }));
    const client = new PayPalClient(config, fetcher);
    await expect(client.captureOrder('ORDER1', 'local-1')).rejects.toMatchObject({ issue: 'INSTRUMENT_DECLINED' });
    await expect(client.captureOrder('ORDER1', 'local-1')).rejects.not.toBeInstanceOf(PayPalIssueError);
  });
});
