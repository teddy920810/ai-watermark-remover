import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadProcessingGrantStore, parseGrantArguments, prepareProcessingCreditAdjustment } from './grant-processing-credits.mjs';

/** Uses the same identity resolver and audited financial store as grants. */
export async function revokeProcessingCredits(options, ports) {
  if (options.unit === 'credits' && !options.grantReference) throw new Error('The original grant reference is required.');
  const adjustment = await prepareProcessingCreditAdjustment(options, ports);
  const { ownerId, balanceBefore, amount, reference, actorId, apply } = adjustment;
  if (adjustment.unit === 'credits') {
    const input = { amount, reference, actor: actorId, grantReference: adjustment.grantReference };
    const outcome = apply ? await ports.store.wallet.revoke(ownerId, input) : await ports.store.wallet.previewRevoke(ownerId, input);
    return { mode: apply ? 'applied' : 'dry-run', unit: 'credits', environment: adjustment.environment, amount, reference, actor: actorId,
      grantReference: adjustment.grantReference, revoked: apply ? outcome.changed : false, balanceBefore,
      balanceAfter: apply ? outcome.balance : outcome.alreadyApplied ? outcome.balance : outcome.balance - amount };
  }
  if (!apply && balanceBefore < amount) throw new Error('Insufficient available processing credits for this revocation preview.');
  // The atomic store must see a replay even if a previous successful revocation
  // depleted the balance. Only a preview may use the earlier unlocked balance.
  const outcome = apply ? await ports.store.revokeCredits(ownerId, amount, reference, actorId) : { revoked: false, balance: balanceBefore - amount };
  return { mode: apply ? 'applied' : 'dry-run', unit: 'processingCredits', amount, reference, actor: actorId, revoked: outcome.revoked, balanceBefore, balanceAfter: outcome.balance };
}
async function main() {
  const options = parseGrantArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000 });
  try { process.stdout.write(`${JSON.stringify(await revokeProcessingCredits(options, { pool, store: await loadProcessingGrantStore(pool, options) }))}\n`); }
  finally { await pool.end(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch { process.stderr.write('Processing credit revocation failed. Check available balance, account and audit reference.\n'); process.exitCode = 1; }
}
