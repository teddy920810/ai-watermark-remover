import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { createPaymentCallbacks, formatPrice, loadPayPalSDK, orderCheckoutStatus, PaymentRequestError, paymentRequest, recoverPaymentOrder, safeReturnPath, type CheckoutStatus, type PaymentCatalog, type PaymentOrder, type PayPalButtons } from './payment-client';
import { canResolveAttempt, parsePaymentAttempt, paymentAccountId, type PaymentAttempt } from './payment-attempt';

function readStored(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function storeValue(key: string, value: string | null) {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* Order history remains the recovery source. */ }
}

const labels: Record<string, string> = {
  created: 'Awaiting payment', pending: 'Confirming payment', fulfilled: 'Credits added',
  refunded: 'Refunded', review: 'Needs review', reversed: 'Reversed', disputed: 'Under review',
};
const imageOperations = [
  { operation: 'watermark-removal', label: 'Watermark removal' },
  { operation: 'background-removal', label: 'Background removal' },
  { operation: 'object-removal', label: 'Object removal' },
] as const;

export default function CreditCheckout() {
  const { data: session, isPending } = authClient.useSession();
  const [catalog, setCatalog] = useState<PaymentCatalog | null>(null);
  const userId = paymentAccountId(session?.user);
  const [catalogError, setCatalogError] = useState(false);
  const [sku, setSku] = useState('');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [ordersError, setOrdersError] = useState(false);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>('idle');
  const [checking, setChecking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [returnTo, setReturnTo] = useState('/app/image');
  const [activeAttempt, setActiveAttempt] = useState<PaymentAttempt | null>(null);
  const [restoredUserId, setRestoredUserId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestKeys = useRef<Record<string, string>>({});
  const activeAttemptRef = useRef<PaymentAttempt | null>(null);
  const displayedOrderRef = useRef<PaymentOrder | null>(null);
  const ordersRequestVersion = useRef(0);
  const currentAccountId = useRef(userId);
  currentAccountId.current = userId;
  const storagePrefix = userId ? `clearmark-payment:${userId}:` : '';

  const showOrder = useCallback((next: PaymentOrder | null) => {
    displayedOrderRef.current = next;
    setOrder(next);
  }, []);

  const saveActiveAttempt = useCallback((next: PaymentAttempt | null) => {
    activeAttemptRef.current = next;
    setActiveAttempt(next);
    if (storagePrefix) storeValue(`${storagePrefix}active`, next ? JSON.stringify(next) : null);
  }, [storagePrefix]);

  const resolveActiveAttempt = useCallback((next: PaymentOrder, expectedRequestKey?: string) => {
    const current = activeAttemptRef.current;
    if (!canResolveAttempt(current, next, expectedRequestKey) || !current) return;
    const keyName = `${storagePrefix}request:${current.sku}`;
    if (requestKeys.current[keyName] === current.requestKey) delete requestKeys.current[keyName];
    if (readStored(keyName) === current.requestKey) storeValue(keyName, null);
    saveActiveAttempt(null);
  }, [saveActiveAttempt, storagePrefix]);

  const loadCatalog = useCallback(async () => {
    setCatalogError(false);
    try {
      const next = await paymentRequest<PaymentCatalog>('/api/payments/catalog');
      setCatalog(next);
      setSku((selected) => next.packages.some((item) => item.sku === selected) ? selected : (next.packages[0]?.sku ?? ''));
    } catch { setCatalogError(true); }
  }, []);

  const loadOrders = useCallback(async (refreshBalances = false) => {
    if (!userId) return;
    const version = ++ordersRequestVersion.current;
    const displayedId = displayedOrderRef.current?.id;
    try {
      const result = await paymentRequest<{ orders: PaymentOrder[] }>('/api/payments/orders');
      if (currentAccountId.current !== userId || version !== ordersRequestVersion.current) return;
      setOrders(result.orders);
      setOrdersError(false);
      const current = displayedOrderRef.current;
      const active = activeAttemptRef.current;
      if (current && current.id === displayedId && (!active || active.orderId === current.id)) {
        const next = result.orders.find((item) => item.id === current.id);
        if (next && (next.status === 'fulfilled' || orderCheckoutStatus(next.status) === 'review')) {
          showOrder(next);
          setStatus(orderCheckoutStatus(next.status));
          resolveActiveAttempt(next);
        }
      }
      if (refreshBalances) window.dispatchEvent(new Event('benefits:changed'));
    } catch {
      if (currentAccountId.current === userId && version === ordersRequestVersion.current) setOrdersError(true);
    }
  }, [resolveActiveAttempt, showOrder, userId]);

  useEffect(() => {
    void loadCatalog();
    setReturnTo(safeReturnPath(new URLSearchParams(window.location.search).get('returnTo')));
  }, [loadCatalog]);

  const refreshPaymentViews = useCallback(() => {
    window.dispatchEvent(new Event('benefits:changed'));
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    let disposed = false;
    setRestoredUserId(null);
    setOrders([]);
    showOrder(null);
    const restored = userId ? parsePaymentAttempt(readStored(`${storagePrefix}active`)) : null;
    activeAttemptRef.current = restored;
    setActiveAttempt(restored);
    setStatus(restored ? 'confirming' : 'idle');
    if (restored) setSku(restored.sku);
    if (userId) {
      setRestoredUserId(userId);
      void loadOrders();
    }
    if (restored?.orderId) {
      void paymentRequest<PaymentOrder>(`/api/payments/orders/${encodeURIComponent(restored.orderId)}`).then((next) => {
        if (disposed || activeAttemptRef.current?.requestKey !== restored.requestKey || activeAttemptRef.current.orderId !== next.id) return;
        showOrder(next);
        setStatus(orderCheckoutStatus(next.status));
        resolveActiveAttempt(next, restored.requestKey);
        if (next.status === 'fulfilled' || orderCheckoutStatus(next.status) === 'review') refreshPaymentViews();
      }).catch(() => { /* Keep the exact attempt available for an explicit recovery. */ });
    }
    return () => { disposed = true; };
  }, [loadOrders, refreshPaymentViews, resolveActiveAttempt, showOrder, storagePrefix, userId]);

  useEffect(() => {
    if (!catalog?.enabled || !catalog.clientId || !userId || restoredUserId !== userId || !sku || !containerRef.current) return;
    let disposed = false;
    let buttons: PayPalButtons | undefined;
    const keyName = `${storagePrefix}request:${sku}`;
    const active = activeAttemptRef.current;
    if (active && active.sku !== sku) return;
    const requestKey = active?.requestKey ?? requestKeys.current[keyName] ?? readStored(keyName) ?? crypto.randomUUID();
    requestKeys.current[keyName] = requestKey;
    storeValue(keyName, requestKey);
    const callbacks = createPaymentCallbacks({
      sku, requestKey,
      onStatus(next) {
        if (disposed) return;
        const current = activeAttemptRef.current;
        if (current && (current.requestKey !== requestKey || current.sku !== sku)) return;
        if (next === 'creating') saveActiveAttempt({ sku, requestKey, ...(current?.orderId ? { orderId: current.orderId } : {}) });
        if (next === 'cancelled' && current?.requestKey === requestKey) saveActiveAttempt(null);
        setStatus(next);
      },
      onOrder(next) {
        if (disposed) return;
        const current = activeAttemptRef.current;
        if (current && current.requestKey !== requestKey) return;
        saveActiveAttempt({ sku, requestKey, orderId: next.id });
        showOrder(next);
        resolveActiveAttempt(next, requestKey);
        if (orderCheckoutStatus(next.status) === 'review') refreshPaymentViews();
      },
      onFulfilled() {
        if (!disposed) refreshPaymentViews();
      },
    });
    void loadPayPalSDK(catalog.clientId).then(async (paypal) => {
      if (disposed || !containerRef.current) return;
      buttons = paypal.Buttons(callbacks);
      await buttons.render(containerRef.current);
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => {
      disposed = true;
      void buttons?.close().catch(() => undefined);
    };
  }, [catalog, generation, refreshPaymentViews, resolveActiveAttempt, restoredUserId, saveActiveAttempt, showOrder, sku, storagePrefix, userId]);

  async function signIn() {
    setSigningIn(true);
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });
    } catch { setStatus('error'); } finally { setSigningIn(false); }
  }

  async function checkOrder(id: string) {
    if (checking || (activeAttemptRef.current && activeAttemptRef.current.orderId !== id)) return;
    const accountId = userId;
    setChecking(true);
    setStatus('confirming');
    const known = orders.find((item) => item.id === id);
    if (known) showOrder(known);
    try {
      const next = await recoverPaymentOrder(id);
      if (accountId !== currentAccountId.current) return;
      if (activeAttemptRef.current && activeAttemptRef.current.orderId !== id) return;
      showOrder(next);
      setStatus(orderCheckoutStatus(next.status));
      resolveActiveAttempt(next);
      if (next.status === 'fulfilled' || orderCheckoutStatus(next.status) === 'review') refreshPaymentViews();
      else void loadOrders();
    } catch (error) {
      if (accountId !== currentAccountId.current) return;
      if (activeAttemptRef.current && activeAttemptRef.current.orderId !== id) return;
      setStatus(error instanceof PaymentRequestError && error.status === 422 && error.code ? (error.code === 'ORDER_NOT_APPROVED' ? 'unpaid' : 'error') : 'confirming');
    } finally { setChecking(false); }
  }

  async function recoverCheckout() {
    const current = activeAttemptRef.current;
    if (!current || current.orderId || checking) return;
    const accountId = userId;
    setChecking(true);
    try {
      const next = await paymentRequest<PaymentOrder>('/api/payments/paypal/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': current.requestKey }, body: JSON.stringify({ sku: current.sku }),
      });
      if (accountId !== currentAccountId.current || activeAttemptRef.current?.requestKey !== current.requestKey) return;
      saveActiveAttempt({ ...current, orderId: next.id });
      showOrder(next);
      setStatus(orderCheckoutStatus(next.status));
      resolveActiveAttempt(next, current.requestKey);
      if (next.status === 'fulfilled' || orderCheckoutStatus(next.status) === 'review') refreshPaymentViews();
    } catch { setStatus('confirming'); } finally { setChecking(false); }
  }

  function resetCheckout() {
    if (activeAttemptRef.current) return;
    setStatus('idle');
    showOrder(null);
    setGeneration((value) => value + 1);
  }

  const selected = catalog?.packages.find((item) => item.sku === sku);
  function selectPackage(nextSku: string) {
    setSku(nextSku);
    setStatus('idle');
    showOrder(null);
  }
  const busy = status === 'creating' || status === 'approving' || status === 'confirming';
  const imageCostsConfigured = catalog?.imageCosts && imageOperations.every(({ operation }) => {
    const amount = catalog.imageCosts?.[operation];
    return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0;
  });

  return (
    <div className="credit-checkout">
      {catalogError ? <div role="alert"><p>Payment options could not load.</p><button className="button button-ghost" type="button" onClick={loadCatalog}>Retry payment options</button></div> : null}
      {!catalog && !catalogError ? <p role="status">Loading payment options…</p> : null}
      {catalog ? <>
        {!catalog.enabled ? <p className="payment-notice" role="status">Purchases are not available yet. No payment can be made. Package prices are previews until checkout opens.</p> : null}
        {catalog.enabled && catalog.environment === 'sandbox' ? <p className="payment-notice">Sandbox checkout — test accounts only. No real payment.</p> : null}
        <fieldset className="credit-packages" disabled={busy || activeAttempt !== null || status === 'fulfilled'}>
          <legend className="sr-only">Choose an image credit package</legend>
          <article className="credit-package credit-package-free">
            <h2 className="credit-package-name">Free</h2>
            <p className="credit-package-description">A little room to try things out.</p>
            <span className="credit-package-price">$0.00 <small>USD</small></span>
            <strong className="credit-package-quantity">Start with free image uses</strong>
            <a className="credit-package-cta" href={returnTo}>Try for free <ArrowRight size={18} aria-hidden="true" /></a>
            <ul className="credit-package-features">
              <li><Check size={17} aria-hidden="true" />1 free use on first sign-in</li>
              <li><Check size={17} aria-hidden="true" />Daily check-in adds 1 free use</li>
              <li><Check size={17} aria-hidden="true" />Free-use balance capped at 3</li>
              <li><Check size={17} aria-hidden="true" />All three standard image tools</li>
              <li><Check size={17} aria-hidden="true" />No purchase needed</li>
            </ul>
          </article>
          {catalog.packages.map((item) => <article key={item.sku} className={`credit-package ${item.sku === 'plus' ? 'is-recommended' : ''} ${sku === item.sku ? 'is-selected' : ''}`}>
            {item.sku === 'plus' ? <span className="credit-package-badge">Recommended</span> : null}
            <input id={`credit-package-${item.sku}`} type="radio" name="credit-package" aria-label={`${item.name}: ${item.credits.toLocaleString('en-US')} credits for ${formatPrice(item.amountCents, item.currency)} ${item.currency}`} value={item.sku} checked={sku === item.sku} onChange={() => selectPackage(item.sku)} />
            <label htmlFor={`credit-package-${item.sku}`} className="credit-package-name">{item.name}</label>
            <span className="credit-package-description">{item.sku === 'starter' ? 'For occasional image edits.' : item.sku === 'plus' ? 'More room for everyday projects.' : item.sku === 'pro' ? 'A bigger balance for bigger batches.' : 'Ready for your next image project.'}</span>
            <span className="credit-package-price">{formatPrice(item.amountCents, item.currency)} <small>{item.currency}</small></span>
            <strong className="credit-package-quantity">{item.credits.toLocaleString('en-US')} credits</strong>
            <button className="credit-package-cta" type="button" onClick={() => selectPackage(item.sku)}>{sku === item.sku ? 'Selected plan' : `Choose ${item.name}`} <ArrowRight size={18} aria-hidden="true" /></button>
            <ul className="credit-package-features">
              <li><Check size={17} aria-hidden="true" />All three standard image tools</li>
              <li><Check size={17} aria-hidden="true" />Free uses are used first</li>
              <li><Check size={17} aria-hidden="true" />No scheduled credit expiry</li>
              <li><Check size={17} aria-hidden="true" />One-time purchase · No automatic renewal</li>
              <li><Check size={17} aria-hidden="true" />Local edits & downloads are free</li>
            </ul>
          </article>)}
        </fieldset>
        <section className="payment-rates" aria-labelledby="payment-rates-heading">
          <div className="payment-rates-intro"><h2 id="payment-rates-heading">Credits per image operation</h2><p>One balance. Three ways to create.</p></div>
          {imageCostsConfigured ? <dl>{imageOperations.map(({ operation, label }) => <div key={operation}><dt>{label}</dt><dd>{catalog.imageCosts?.[operation].toLocaleString('en-US')} credits</dd></div>)}</dl> : <p>Open a supported image tool to check its current credit cost before processing.</p>}
        </section>
        <section className="payment-review" aria-labelledby="payment-review-heading">
          <div>
            <h2 id="payment-review-heading">Review your purchase</h2>
            {selected ? <p>{selected.credits.toLocaleString('en-US')} image credits · <strong>{formatPrice(selected.amountCents, selected.currency)} {selected.currency}</strong> total</p> : null}
            <p>For standard watermark removal, background removal, and object removal. PRO, brush refinement, and video processing use separate administrator credits; package names do not unlock these modes.</p>
            <p>Free uses are used first. Failed operations return credits or free uses to their original source. Credits are added to your signed-in account after payment is confirmed. No automatic renewal.</p>
            <p><a href="/terms">Purchase and refund terms</a></p>
          </div>
          <div className="payment-action">
            {!userId && !isPending ? <button className="button button-primary" type="button" onClick={signIn} disabled={signingIn || !catalog.enabled}>{signingIn ? 'Connecting…' : 'Sign in with Google to buy'}</button> : null}
            {isPending ? <p role="status">Checking sign-in…</p> : null}
            {userId && !catalog.enabled ? <button className="button button-primary" type="button" disabled>Checkout unavailable</button> : null}
            <div ref={containerRef} className="paypal-button-container" hidden={!userId || !catalog.enabled || status === 'fulfilled' || status === 'confirming'} />
            {status === 'creating' ? <p role="status">Creating your order…</p> : null}
            {status === 'approving' ? <p role="status">Complete payment in the PayPal window.</p> : null}
            {status === 'cancelled' ? <p role="status">Checkout cancelled. You can use the PayPal button when you are ready.</p> : null}
            {status === 'unpaid' ? <p role="status">This order has not been approved for payment. Continue with PayPal when you are ready.</p> : null}
            {status === 'error' ? <p role="alert">PayPal could not complete checkout. Check your order history, then try another available payment method.</p> : null}
          </div>
        </section>
      </> : null}
      {status === 'confirming' ? <section className="payment-outcome" role="status">
        <h2>Confirming your payment</h2><p>Please do not pay again. Check this order to recover a delayed confirmation.</p>
        {order || activeAttempt?.orderId ? <><p>Order: <code>{order?.id ?? activeAttempt?.orderId}</code></p><button className="button button-primary" type="button" onClick={() => checkOrder((order?.id ?? activeAttempt?.orderId) as string)} disabled={checking}>{checking ? 'Checking…' : 'Check payment'}</button></> : activeAttempt ? <button className="button button-primary" type="button" onClick={recoverCheckout} disabled={checking}>{checking ? 'Checking…' : 'Recover checkout'}</button> : <button className="button button-ghost" type="button" onClick={() => loadOrders(true)}>Refresh order history</button>}
      </section> : null}
      {status === 'fulfilled' && order ? <section className="payment-outcome" role="status">
        <h2>Your credits have arrived</h2><p>{order.credits.toLocaleString('en-US')} image credits were added. Order: <code>{order.id}</code></p>
        <a className="button button-primary" href={returnTo}>Return to image tools</a>
        <button className="button button-ghost" type="button" onClick={resetCheckout}>Make another purchase</button>
      </section> : null}
      {status === 'review' && order ? <section className="payment-outcome" role="status">
        <h2>{labels[order.status] ?? 'Order needs review'}</h2><p>This order cannot add more credits. Contact support with order <code>{order.id}</code> if you need help.</p>
        <button className="button button-ghost" type="button" onClick={resetCheckout}>Back to packages</button>
      </section> : null}
      <section className="payment-history" id="orders" aria-labelledby="payment-orders-heading">
        <div className="payment-history-heading"><h2 id="payment-orders-heading">Your orders</h2>{userId ? <button type="button" className="button button-ghost" onClick={() => loadOrders(true)} disabled={busy || checking || activeAttempt !== null}>Refresh orders</button> : null}</div>
        {!userId ? <p>Sign in to see purchases for your account.</p> : ordersError ? <p role="alert">Your order history could not load. Refresh it before making another purchase.</p> : orders.length === 0 ? <p>No purchases yet.</p> : <div className="payment-table-wrap"><table><thead><tr><th scope="col">Order</th><th scope="col">Credits</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{orders.map((item) => <tr key={item.id}>
          <td><code>{item.id}</code><small>{new Date(item.createdAt).toLocaleDateString()}</small></td><td>{item.credits}</td><td>{formatPrice(item.amountCents, item.currency)}</td><td>{labels[item.status] ?? 'Needs review'}</td><td><button type="button" disabled={busy || checking || activeAttempt !== null} onClick={() => checkOrder(item.id)}>Check order</button></td>
        </tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}
