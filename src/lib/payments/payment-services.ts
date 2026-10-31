import { Pool } from 'pg';
import { getPaymentConfig } from './payment-config';
import { PayPalClient } from './paypal-client';
import { PaymentError, PaymentService } from './payment-service';
import { PostgresPaymentStore } from './postgres-payment-store';

let cached: PaymentService | undefined;
export function getPaymentService() {
  if (cached) return cached;
  const config = getPaymentConfig();
  if (!config.creditsEnabled || !process.env.DATABASE_URL) throw new PaymentError('Payments are not configured.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
  return cached = new PaymentService(config, new PostgresPaymentStore(pool, config.environment), new PayPalClient(config));
}
