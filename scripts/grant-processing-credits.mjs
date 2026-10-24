import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function validate(options) {
  const email = options.email?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid --email is required.');
  if (!Number.isSafeInteger(options.amount) || options.amount <= 0) throw new Error('Positive integer --credits is required.');
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(options.reference ?? '')) throw new Error('A safe audit --reference is required.');
  if (!/^[a-zA-Z0-9:@._-]{1,160}$/.test(options.actorId ?? '')) throw new Error('An explicit administrator --actor is required.');
  return { ...options, email };
}
export function parseGrantArguments(argv) {
  const options = { apply: false }; const seen = new Set();
  const names = { '--email': 'email', '--credits': 'amount', '--reference': 'reference', '--actor': 'actorId' };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (seen.has(name)) throw new Error('Repeated grant argument.'); seen.add(name);
    if (name === '--apply') { options.apply = true; continue; }
    if (!Object.hasOwn(names, name) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Unknown or incomplete grant argument.');
    const value = argv[++index]; options[names[name]] = name === '--credits' ? Number(value) : value;
  }
  return validate(options);
}
export async function prepareProcessingCreditAdjustment(options, { pool, store }) {
  const grant = validate(options);
  const result = await pool.query('SELECT user_id FROM user_benefit_identities WHERE LOWER(email) = LOWER($1)', [grant.email]);
  if (result.rows.length !== 1) throw new Error('Exactly one initialized account must match the email; sign in and open the account allowance first.');
  const owner = result.rows[0].user_id;
  const balanceBefore = await store.getBalance(owner);
  return { ...grant, ownerId: owner, balanceBefore };
}
/** DB access itself is the administrator permission. No browser grant endpoint exists. */
export async function grantProcessingCredits(options, ports) {
  const grant = await prepareProcessingCreditAdjustment(options, ports);
  const { ownerId: owner, balanceBefore } = grant; const { store } = ports;
  if (!grant.apply && !Number.isSafeInteger(balanceBefore + grant.amount)) throw new Error('Credit balance exceeds the supported amount.');
  const outcome = grant.apply ? await store.grantCredits(owner, grant.amount, grant.reference, grant.actorId) : { granted: false, balance: balanceBefore + grant.amount };
  return { mode: grant.apply ? 'applied' : 'dry-run', unit: 'processingCredits', amount: grant.amount, reference: grant.reference, actor: grant.actorId, granted: outcome.granted, balanceBefore, balanceAfter: outcome.balance };
}
export async function loadProcessingGrantStore(pool) {
  const { build } = await import('esbuild');
  const outfile = join(root, 'output/admin', `processing-grant-${randomUUID()}.mjs`);
  await mkdir(dirname(outfile), { recursive: true });
  try {
    await build({ absWorkingDir: root, entryPoints: [join(root, 'src/lib/processing/postgres-processing-store.ts')], outfile, bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', logLevel: 'silent' });
    const { PostgresProcessingStore } = await import(pathToFileURL(outfile).href);
    return new PostgresProcessingStore(pool);
  } finally { await unlink(outfile).catch(() => undefined); }
}
async function main() {
  const options = parseGrantArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000 });
  try { process.stdout.write(`${JSON.stringify(await grantProcessingCredits(options, { pool, store: await loadProcessingGrantStore(pool) }))}\n`); }
  finally { await pool.end(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch { process.stderr.write('Processing credit grant failed. Check server configuration, initialized account and audit arguments.\n'); process.exitCode = 1; }
}
