import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentAdjustmentReason, PaymentCapture, PaymentEvent, PaymentOrder, PaymentPurchase, PaymentStore } from './payment-store';

interface OrderRow {
  environment: 'sandbox' | 'live';
  id: string;
  user_id: string;
  request_key: string;
  sku: string;
  catalog_version: string;
  credits: number;
  amount_cents: number;
  currency: 'USD';
  paypal_order_id: string | null;
  capture_id: string | null;
  status: PaymentOrder['status'];
  created_at: Date | string;
}

function order(row: OrderRow): PaymentOrder {
  return {
    environment: row.environment, id: row.id, userId: row.user_id, requestKey: row.request_key, sku: row.sku,
    catalogVersion: row.catalog_version, credits: row.credits, amountCents: row.amount_cents,
    currency: row.currency, paypalOrderId: row.paypal_order_id, captureId: row.capture_id,
    status: row.status, createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PostgresPaymentStore implements PaymentStore {
  constructor(private readonly pool: Pool, private readonly environment: 'sandbox' | 'live' = 'sandbox') {}

  async createOrder(userId: string, purchase: PaymentPurchase, requestKey: string): Promise<PaymentOrder> {
    if (!userId || !requestKey || requestKey.length > 128 || !purchase.sku || !purchase.catalogVersion
      || !Number.isSafeInteger(purchase.credits) || purchase.credits < 1 || purchase.credits > 1_000_000
      || !Number.isSafeInteger(purchase.amountCents) || purchase.amountCents < 1 || purchase.amountCents > 100_000_000
      || purchase.currency !== 'USD') throw new Error('Invalid payment purchase');
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-orders:${this.environment}:${userId}`]);
      const previous = await client.query<OrderRow>('SELECT * FROM payment_orders WHERE user_id = $1 AND request_key = $2 AND environment=$3', [userId, requestKey, this.environment]);
      if (!previous.rows.length) {
        const recent = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM payment_orders WHERE user_id=$1 AND environment=$2 AND created_at > NOW() - INTERVAL '15 minutes'", [userId, this.environment]);
        if (recent.rows[0].count >= 20) throw new Error('Too many payment orders. Try again later.');
      }
      await client.query(`
        INSERT INTO payment_orders (id, user_id, request_key, sku, catalog_version, credits, amount_cents, currency,environment)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (environment,user_id, request_key) DO NOTHING
      `, [randomUUID(), userId, requestKey, purchase.sku, purchase.catalogVersion, purchase.credits, purchase.amountCents, purchase.currency,this.environment]);
      const result = await client.query<OrderRow>('SELECT * FROM payment_orders WHERE user_id = $1 AND request_key = $2 AND environment=$3 FOR UPDATE', [userId, requestKey,this.environment]);
      const existing = order(result.rows[0]);
      if (existing.sku !== purchase.sku || existing.catalogVersion !== purchase.catalogVersion
        || existing.credits !== purchase.credits || existing.amountCents !== purchase.amountCents || existing.currency !== purchase.currency) {
        throw new Error('Payment request already belongs to another purchase');
      }
      return existing;
    });
  }

  async attachPaypalOrder(id: string, paypalOrderId: string): Promise<PaymentOrder> {
    if (!paypalOrderId) throw new Error('Invalid PayPal order');
    return this.transaction(async (client) => {
      const current = await this.lockOrder(client, id);
      if (current.paypal_order_id && current.paypal_order_id !== paypalOrderId) throw new Error('PayPal order already assigned');
      const result = await client.query<OrderRow>('UPDATE payment_orders SET paypal_order_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *', [id, paypalOrderId]);
      return order(result.rows[0]);
    });
  }

  getOrder(id: string): Promise<PaymentOrder | null> { return this.find('id', id); }
  getOrderByPaypalId(id: string): Promise<PaymentOrder | null> { return this.find('paypal_order_id', id); }
  getOrderByCaptureId(id: string): Promise<PaymentOrder | null> { return this.find('capture_id', id); }

  async listOrders(userId: string): Promise<PaymentOrder[]> {
    return this.transaction(async (client) => {
      const result = await client.query<OrderRow>('SELECT * FROM payment_orders WHERE user_id = $1 AND environment=$2 ORDER BY created_at DESC, id DESC LIMIT 50', [userId,this.environment]);
      return result.rows.map(order);
    });
  }

  async fulfill(orderId: string, capture: PaymentCapture): Promise<PaymentOrder> {
    if (!capture.id) throw new Error('Capture does not match payment order');
    return this.transaction(async (client) => {
      // Use the same lock order as adjustments: capture, order, user, then credit lot.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-capture:${this.environment}:${capture.id}`]);
      const current = await this.lockOrder(client, orderId);
      if (!capture.id || !capture.merchantId || current.paypal_order_id !== capture.paypalOrderId
        || current.amount_cents !== capture.amountCents || current.currency !== capture.currency
        || (current.capture_id && current.capture_id !== capture.id)) throw new Error('Capture does not match payment order');
      if (current.status !== 'created') return order(current);
      await this.lockUser(client, current.user_id);
      const adjustments = await client.query('SELECT id FROM payment_adjustments WHERE capture_id = $1 AND environment=$2', [capture.id,this.environment]);
      const status = adjustments.rows.length ? 'review' : 'fulfilled';
      if (status === 'fulfilled') {
        await client.query(`INSERT INTO paid_credit_lots (id,order_id,user_id,granted,available) VALUES ($1,$1,$2,$3,$3)`, [current.id, current.user_id, current.credits]);
        await client.query(`INSERT INTO paid_credit_ledger (user_id,lot_id,delta,balance_after,reason,reference_id) VALUES ($1,$2,$3,$3,'purchase',$4)`, [current.user_id, current.id, current.credits, capture.id]);
      }
      const updated = await client.query<OrderRow>(`
        UPDATE payment_orders SET capture_id=$2, merchant_id=$3, status=$4, updated_at=NOW() WHERE id=$1 RETURNING *
      `, [current.id, capture.id, capture.merchantId, status]);
      return order(updated.rows[0]);
    });
  }

  async recordEvent(event: PaymentEvent): Promise<boolean> {
    if (!event.id || !event.eventType || !event.resourceId || JSON.stringify(event.payload).length > 16_384) throw new Error('Invalid payment event');
    return this.transaction(async (client) => {
      await client.query('INSERT INTO payment_events (id,event_type,resource_id,payload,environment) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (environment,id) DO NOTHING', [event.id, event.eventType, event.resourceId, JSON.stringify(event.payload),this.environment]);
      const result = await client.query<{ event_type: string; resource_id: string; processed_at: Date | null }>('SELECT event_type,resource_id,processed_at FROM payment_events WHERE id=$1 AND environment=$2 FOR UPDATE', [event.id,this.environment]);
      const existing = result.rows[0];
      if (existing.event_type !== event.eventType || existing.resource_id !== event.resourceId) throw new Error('Conflicting payment event');
      return existing.processed_at === null;
    });
  }

  async completeEvent(id: string): Promise<void> {
    await this.transaction(async (client) => { await client.query('UPDATE payment_events SET processed_at=NOW() WHERE id=$1 AND environment=$2 AND processed_at IS NULL', [id,this.environment]); });
  }

  async applyAdjustment(refId: string, captureId: string, reason: PaymentAdjustmentReason, amountCents: number): Promise<void> {
    if (!refId || !captureId || !['refund','reversal','dispute'].includes(reason) || !Number.isSafeInteger(amountCents) || amountCents < 0 || (reason === 'refund' && amountCents === 0)) throw new Error('Invalid payment adjustment');
    await this.transaction(async (client) => {
      // Serialize with fulfillment before looking up an as-yet-unassigned capture.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`paypal-capture:${this.environment}:${captureId}`]);
      await client.query('INSERT INTO payment_adjustments (id,capture_id,reason,amount_cents,environment) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (environment,id) DO NOTHING', [refId, captureId, reason, amountCents,this.environment]);
      const existing = await client.query<{ capture_id: string; reason: string; amount_cents: number }>('SELECT capture_id,reason,amount_cents FROM payment_adjustments WHERE id=$1 AND environment=$2', [refId,this.environment]);
      if (existing.rows[0].capture_id !== captureId || existing.rows[0].reason !== reason || existing.rows[0].amount_cents !== amountCents) throw new Error('Conflicting payment adjustment');
      const found = await client.query<OrderRow>('SELECT * FROM payment_orders WHERE capture_id=$1 AND environment=$2 FOR UPDATE', [captureId,this.environment]);
      const current = found.rows[0];
      if (!current) return;
      await this.lockUser(client, current.user_id);
      const lots = await client.query<{ id: string; available: number; granted: number; status: string }>('SELECT id,available,granted,status FROM paid_credit_lots WHERE order_id=$1 FOR UPDATE', [current.id]);
      const lot = lots.rows[0];
      if (lot?.status === 'active') {
        await client.query("UPDATE paid_credit_lots SET available=0,status='frozen' WHERE id=$1", [lot.id]);
        await client.query(`INSERT INTO paid_credit_ledger (user_id,lot_id,delta,balance_after,reason,reference_id) VALUES ($1,$2,$3,0,'adjustment',$4)`, [current.user_id, lot.id, -lot.available, captureId]);
      }
      const reservations = await client.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count FROM job_credit_reservations r
        WHERE r.status IN ('reserved','consumed') AND (
          r.lot_id=$1 OR EXISTS (
            SELECT 1 FROM paid_credit_allocations a WHERE a.job_id=r.job_id AND a.lot_id=$1
          )
        )
      `, [current.id]);
      const fullUnusedRefund = reason === 'refund' && amountCents === current.amount_cents && reservations.rows[0].count === 0;
      const status = current.status === 'refunded' ? 'refunded' : fullUnusedRefund ? 'refunded' : 'review';
      await client.query('UPDATE payment_orders SET status=$2,updated_at=NOW() WHERE id=$1', [current.id, status]);
    });
  }

  private async find(field: 'id' | 'paypal_order_id' | 'capture_id', value: string): Promise<PaymentOrder | null> {
    return this.transaction(async (client) => {
      const result = await client.query<OrderRow>(`SELECT * FROM payment_orders WHERE ${field}=$1 AND environment=$2`, [value,this.environment]);
      return result.rows[0] ? order(result.rows[0]) : null;
    });
  }

  private async lockOrder(client: PoolClient, id: string): Promise<OrderRow> {
    const result = await client.query<OrderRow>('SELECT * FROM payment_orders WHERE id=$1 AND environment=$2 FOR UPDATE', [id,this.environment]);
    if (!result.rows[0]) throw new Error('Payment order not found');
    return result.rows[0];
  }

  private async lockUser(client: PoolClient, userId: string): Promise<void> {
    const inserted = await client.query(`INSERT INTO user_benefits(user_id,balance) VALUES ($1,1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`, [userId]);
    if (inserted.rows[0]) await client.query(`INSERT INTO benefit_ledger(user_id,delta,balance_after,reason,reference_id) VALUES ($1,1,1,'first_use',$1)`, [userId]);
    await client.query('SELECT user_id FROM user_benefits WHERE user_id=$1 FOR UPDATE', [userId]);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
