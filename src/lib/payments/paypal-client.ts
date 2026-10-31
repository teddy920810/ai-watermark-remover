import type { PaymentConfig } from './payment-config';

type Credentials = Pick<PaymentConfig, 'environment' | 'clientId' | 'clientSecret' | 'merchantId' | 'webhookId'>;
export class PayPalIssueError extends Error {
  constructor(readonly issue: string) { super('PayPal requires a different payment method or payer action'); }
}
export interface PayPalCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
  links?: { rel: string; href: string }[];
}
export interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    payee?: { merchant_id?: string };
    amount: { currency_code: string; value: string };
    payments?: { captures?: PayPalCapture[] };
  }[];
}
export interface PayPalGateway {
  createOrder(order: { id: string; sku: string; amountCents: number; credits: number; currency: 'USD' }): Promise<PayPalOrder>;
  captureOrder(paypalOrderId: string, localId: string): Promise<PayPalOrder>;
  getOrder(id: string): Promise<PayPalOrder>;
  getCapture(id: string): Promise<PayPalCapture>;
  getRefund(id: string): Promise<PayPalCapture>;
  verifyWebhook(headers: Headers, event: unknown): Promise<boolean>;
}

export function cents(value: string): number {
  if (!/^(0|[1-9]\d{0,8})\.\d{2}$/.test(value)) throw new Error('Invalid PayPal amount');
  return Number(value.replace('.', ''));
}

// REST contracts: https://developer.paypal.com/api/orders/v2 and /api/rest/reference/idempotency/
export class PayPalClient implements PayPalGateway {
  private token?: { value: string; expires: number };
  private readonly base: string;
  constructor(private readonly config: Credentials, private readonly fetcher: typeof fetch = fetch) {
    this.base = config.environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }
  async createOrder(order: { id: string; sku: string; amountCents: number; credits: number; currency: 'USD' }) {
    const amount = { currency_code: order.currency, value: (order.amountCents / 100).toFixed(2) };
    return this.request<PayPalOrder>('/v2/checkout/orders', {
      method: 'POST', requestId: `create-${order.id}`,
      body: { intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.id,
        payee: { merchant_id: this.config.merchantId },
        amount: { ...amount, breakdown: { item_total: amount } },
        items: [{ name: `${order.credits} image processing credits`, sku: order.sku, quantity: '1', category: 'DIGITAL_GOODS', unit_amount: amount }],
      }], payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } } },
    });
  }
  async captureOrder(id: string, localId: string) { return this.request<PayPalOrder>(`/v2/checkout/orders/${this.id(id)}/capture`, { method: 'POST', requestId: `capture-${localId}`, body: {} }); }
  async getOrder(id: string) { return this.request<PayPalOrder>(`/v2/checkout/orders/${this.id(id)}`); }
  async getCapture(id: string) { return this.request<PayPalCapture>(`/v2/payments/captures/${this.id(id)}`); }
  async getRefund(id: string) { return this.request<PayPalCapture>(`/v2/payments/refunds/${this.id(id)}`); }

  // https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post
  async verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
    const fields = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
    if (fields.some((field) => !headers.get(field))) return false;
    let certificate: URL;
    try { certificate = new URL(headers.get('paypal-cert-url')!); } catch { return false; }
    if (certificate.protocol !== 'https:' || !/(^|\.)paypal\.com$/.test(certificate.hostname) || certificate.username || certificate.password || certificate.port) return false;
    const result = await this.request<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', { method: 'POST', body: {
      auth_algo: headers.get(fields[0]), cert_url: headers.get(fields[1]), transmission_id: headers.get(fields[2]),
      transmission_sig: headers.get(fields[3]), transmission_time: headers.get(fields[4]), webhook_id: this.config.webhookId, webhook_event: event,
    } });
    return result.verification_status === 'SUCCESS';
  }
  private id(id: string) { if (!/^[A-Z0-9-]{1,64}$/.test(id)) throw new Error('Invalid PayPal resource'); return id; }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    const response = await this.fetcher(`${this.base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!response.ok) throw new Error('PayPal is temporarily unavailable');
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!result.access_token) throw new Error('PayPal is temporarily unavailable');
    this.token = { value: result.access_token, expires: Date.now() + Math.max(0, (result.expires_in ?? 0) - 60) * 1000 };
    return this.token.value;
  }
  private async request<T>(path: string, options: { method?: string; body?: unknown; requestId?: string } = {}): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    if (options.requestId) headers['PayPal-Request-Id'] = options.requestId;
    const response = await this.fetcher(`${this.base}${path}`, { method: options.method ?? 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20_000), ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { details?: { issue?: string }[] };
      const issue = error.details?.[0]?.issue;
      if (response.status === 422 && issue && ['INSTRUMENT_DECLINED', 'PAYER_ACTION_REQUIRED', 'TRANSACTION_REFUSED', 'ORDER_NOT_APPROVED'].includes(issue)) throw new PayPalIssueError(issue);
      throw new Error('PayPal is temporarily unavailable');
    }
    return response.json() as Promise<T>;
  }
}
