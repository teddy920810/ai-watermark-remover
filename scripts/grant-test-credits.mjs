/* global console, process */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const FREE_USE_CAP = 3;
const REFERENCE_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export function planTestCreditGrant({ currentBalance, requestedUses, reference }) {
  if (!Number.isInteger(currentBalance) || currentBalance < 0 || currentBalance > FREE_USE_CAP) {
    throw new Error('Current balance must be between 0 and 3.');
  }
  if (!Number.isInteger(requestedUses) || requestedUses < 1 || requestedUses > FREE_USE_CAP) {
    throw new Error('Requested test uses must be between 1 and 3.');
  }
  if (!REFERENCE_PATTERN.test(reference)) {
    throw new Error('The audit reference must be 3-64 lowercase letters, numbers, dots, underscores, or hyphens.');
  }

  const appliedUses = Math.min(requestedUses, FREE_USE_CAP - currentBalance);
  return {
    appliedUses,
    balanceAfter: currentBalance + appliedUses,
    ledgerReferences: Array.from({ length: appliedUses }, (_, index) => `${reference}:${index + 1}`),
  };
}

function parseArgs(argv) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (!argument?.startsWith('--')) throw new Error(`Unexpected argument: ${argument ?? ''}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    values.set(argument, value);
    index += 1;
  }

  const email = values.get('--email')?.trim().toLowerCase();
  const reference = values.get('--reference')?.trim();
  const requestedUses = Number(values.get('--uses'));
  if (!email || !email.includes('@')) throw new Error('A valid --email is required.');
  if (!reference) throw new Error('An audit --reference is required.');
  if (!Number.isInteger(requestedUses)) throw new Error('An integer --uses value is required.');
  return { apply, email, reference, requestedUses };
}

export async function grantTestCredits({ pool, email, requestedUses, reference, apply }) {
  const client = await pool.connect();
  try {
    if (apply) await client.query('BEGIN');
    const result = await client.query(`
      SELECT u.id AS user_id, benefits.balance::int AS balance
      FROM "user" u
      JOIN user_benefits benefits ON benefits.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1)
      ${apply ? 'FOR UPDATE OF benefits' : ''}
    `, [email]);
    if (result.rows.length !== 1) throw new Error('No initialized benefit account matches that email.');

    const currentBalance = result.rows[0].balance;
    const plan = planTestCreditGrant({ currentBalance, requestedUses, reference });
    let appliedUses = 0;
    let balanceAfter = currentBalance;

    if (apply) {
      for (const ledgerReference of plan.ledgerReferences) {
        const nextBalance = balanceAfter + 1;
        const inserted = await client.query(`
          INSERT INTO benefit_ledger (user_id, delta, balance_after, reason, reference_id)
          VALUES ($1, 1, $2, 'test_grant', $3)
          ON CONFLICT (user_id, reason, reference_id) DO NOTHING
          RETURNING id
        `, [result.rows[0].user_id, nextBalance, ledgerReference]);
        if (!inserted.rows[0]) continue;
        await client.query(`
          UPDATE user_benefits
          SET balance = $2, last_active_at = NOW()
          WHERE user_id = $1
        `, [result.rows[0].user_id, nextBalance]);
        balanceAfter = nextBalance;
        appliedUses += 1;
      }
      await client.query('COMMIT');
    }

    return {
      mode: apply ? 'applied' : 'dry-run',
      requestedUses,
      appliedUses: apply ? appliedUses : plan.appliedUses,
      balanceBefore: currentBalance,
      balanceAfter: apply ? balanceAfter : plan.balanceAfter,
    };
  } catch (error) {
    if (apply) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000 });
  try {
    const outcome = await grantTestCredits({ pool, ...options });
    console.log(JSON.stringify(outcome));
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
