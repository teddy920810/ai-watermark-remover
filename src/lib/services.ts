import { getWebDatabasePool } from './runtime/web-database-pool';
import { z } from 'zod';
import { PostgresBenefitStore } from './benefits/postgres-benefit-store';
import { getPaymentConfig } from './payments/payment-config';
import { creditsConfiguration } from './credits/credit-policy';


let cachedAccounts: ReturnType<typeof createAccountServices> | undefined;

function createAccountServices() {
  const databaseUrl = z.url().parse(process.env.DATABASE_URL);
  const config = getPaymentConfig();
  const pool = getWebDatabasePool(databaseUrl);
  const benefits = new PostgresBenefitStore(pool, config.creditsEnabled, config.environment, config.imageCosts, config.creditsEnabled ? config.imageCostVersion : undefined, creditsConfiguration(process.env));
  return { pool, benefits };
}

export function getAccountServices() {
  return (cachedAccounts ??= createAccountServices());
}
