export interface CreditPackage {
  sku: string;
  name: string;
  credits: number;
  amountCents: number;
  currency: 'USD';
}

export interface PaymentCatalog {
  enabled: boolean;
  creditsEnabled?: boolean;
  environment: 'sandbox' | 'live';
  clientId?: string;
  packages: CreditPackage[];
  imageCosts?: Record<'watermark-removal' | 'background-removal' | 'object-removal', number>;
  imageCostVersion?: string;
}

export interface PaymentOrder {
  id: string;
  paypalOrderId?: string;
  sku: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
}

export type CheckoutStatus = 'idle' | 'creating' | 'approving' | 'confirming' | 'fulfilled' | 'cancelled' | 'error' | 'review' | 'unpaid';

export function orderCheckoutStatus(status: string): CheckoutStatus {
  if (status === 'fulfilled') return 'fulfilled';
  return ['review', 'refunded', 'reversed', 'disputed'].includes(status) ? 'review' : 'confirming';
}

export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app/image';
  const url = new URL(value, 'https://local.invalid');
  return url.origin === 'https://local.invalid' && !['/pricing', '/app/credits'].includes(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : '/app/image';
}

export function formatPrice(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountCents / 100);
}

export class PaymentRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super('The request could not be confirmed. Please check the order before trying again.');
  }
}

export async function paymentRequest<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(path, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: unknown } | null;
    const safeCodes = ['INSTRUMENT_DECLINED', 'PAYER_ACTION_REQUIRED', 'TRANSACTION_REFUSED', 'ORDER_NOT_APPROVED'];
    const code = typeof body?.code === 'string' && safeCodes.includes(body.code) ? body.code : undefined;
    throw new PaymentRequestError(response.status, code);
  }
  return response.json() as Promise<T>;
}

export async function recoverPaymentOrder(id: string, fetcher?: typeof fetch): Promise<PaymentOrder> {
  const pathId = encodeURIComponent(id);
  const order = await paymentRequest<PaymentOrder>(`/api/payments/orders/${pathId}`, undefined, fetcher);
  if ((order.status === 'created' || order.status === 'pending') && order.paypalOrderId) {
    return paymentRequest<PaymentOrder>(`/api/payments/paypal/orders/${pathId}/capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, fetcher);
  }
  return order;
}

// Keep the Standard Checkout contract: createOrder returns the server-created ID;
// onApprove captures on the server. Browser approval is never fulfilment evidence.
// https://developer.paypal.com/studio/checkout/standard/integrate
export function createPaymentCallbacks(options: {
  sku: string;
  requestKey: string;
  fetcher?: typeof fetch;
  onStatus: (status: CheckoutStatus) => void;
  onOrder: (order: PaymentOrder) => void;
  onFulfilled: () => void;
}) {
  let order: PaymentOrder | undefined;
  const knownOutcome = (): CheckoutStatus => order?.status === 'fulfilled' ? 'fulfilled' : order && orderCheckoutStatus(order.status) === 'review' ? 'review' : 'error';
  return {
    async createOrder() {
      options.onStatus('creating');
      try {
        order = await paymentRequest<PaymentOrder>('/api/payments/paypal/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': options.requestKey },
          body: JSON.stringify({ sku: options.sku }),
        }, options.fetcher);
        options.onOrder(order);
        if (order.status === 'fulfilled') {
          options.onStatus('fulfilled');
          options.onFulfilled();
          throw new Error('This order is already completed.');
        }
        if (orderCheckoutStatus(order.status) === 'review') throw new Error('This order needs review.');
        if (!order.paypalOrderId) throw new Error('Order unavailable');
        options.onStatus('approving');
        return order.paypalOrderId;
      } catch (error) {
        options.onStatus(knownOutcome());
        throw error;
      }
    },
    async onApprove(data: { orderID: string }, actions?: { restart: () => Promise<void> }) {
      if (!order || data.orderID !== order.paypalOrderId) {
        options.onStatus('error');
        return;
      }
      options.onStatus('confirming');
      try {
        const captured = await paymentRequest<PaymentOrder>(`/api/payments/paypal/orders/${encodeURIComponent(order.id)}/capture`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }, options.fetcher);
        order = captured;
        options.onOrder(captured);
        options.onStatus(orderCheckoutStatus(captured.status));
        if (captured.status === 'fulfilled') {
          options.onFulfilled();
        }
      } catch (error) {
        if (error instanceof PaymentRequestError && error.status === 422 && error.code) {
          if (error.code === 'INSTRUMENT_DECLINED' && actions) {
            options.onStatus('approving');
            // PayPal's documented funding-failure recovery restarts Checkout.
            // https://developer.paypal.com/studio/checkout/standard/integrate
            return actions.restart();
          }
          options.onStatus(error.code === 'ORDER_NOT_APPROVED' ? 'unpaid' : 'error');
          return;
        }
        // A timeout can follow a successful capture. Keep the existing order.
        options.onStatus('confirming');
      }
    },
    onCancel() { options.onStatus(order?.status === 'fulfilled' ? 'fulfilled' : 'cancelled'); },
    onError() { options.onStatus(knownOutcome()); },
  };
}

export interface PayPalButtons {
  render: (container: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
}

export interface PayPalSDK {
  Buttons: (options: ReturnType<typeof createPaymentCallbacks>) => PayPalButtons;
}

declare global { interface Window { paypal?: PayPalSDK } }

let sdkPromise: Promise<PayPalSDK> | undefined;
let sdkClientId: string | undefined;

export function loadPayPalSDK(clientId: string): Promise<PayPalSDK> {
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;
  if (sdkClientId && sdkClientId !== clientId) return Promise.reject(new Error('Reload this page to refresh payment settings.'));
  sdkClientId = clientId;
  sdkPromise = new Promise<PayPalSDK>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=buttons`;
    script.setAttribute('data-sdk-integration-source', 'developer-studio');
    script.onload = () => window.paypal ? resolve(window.paypal) : reject(new Error('PayPal is unavailable'));
    script.onerror = () => { script.remove(); sdkPromise = undefined; sdkClientId = undefined; reject(new Error('PayPal could not load')); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}
