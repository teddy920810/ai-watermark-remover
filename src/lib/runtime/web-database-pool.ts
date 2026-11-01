import { Pool } from 'pg';

let shared: { connectionString: string; pool: Pool } | undefined;

/** Process-owned Web resource. Request/runtime instances borrow it; Workers own separate pools. */
export function getWebDatabasePool(connectionString: string): Pool {
  if (shared && shared.connectionString !== connectionString) throw new Error('Web database configuration changed');
  if (!shared) shared = { connectionString, pool: new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 }) };
  return shared.pool;
}
