import process from 'node:process';
import { readFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
export function parseCreditMigrationArguments(argv) {
  const options = { action: 'preview', apply: false, databaseEnv: 'CREDITS_MIGRATION_DATABASE_URL' };
  const names = { '--owner': 'ownerId', '--environment': 'environment', '--proof': 'proofPath', '--actor': 'actor', '--reference': 'reference', '--action': 'action', '--expected-digest': 'expectedDigest', '--db-env': 'databaseEnv' };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (seen.has(key)) throw new Error('Repeated migration argument'); seen.add(key);
    if (key === '--apply') { options.apply = true; continue; }
    if (!Object.hasOwn(names, key) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Unknown or incomplete migration argument');
    options[names[key]] = argv[++index];
  }
  if (!options.ownerId || options.ownerId.length > 512 || !['sandbox', 'live'].includes(options.environment) || !options.proofPath
    || !options.actor?.trim() || options.actor.length > 160 || !/^[a-zA-Z0-9:_-]{1,160}$/.test(options.reference ?? '')
    || !['preview', 'drain', 'apply'].includes(options.action) || !/^CREDITS_[A-Z0-9_]*DATABASE_URL$/.test(options.databaseEnv)) throw new Error('Explicit account, environment, proof and audit arguments are required');
  if (options.action === 'preview' && options.apply || options.action !== 'preview' && !options.apply) throw new Error('A mutating action requires an explicit --apply');
  if (options.action === 'apply' && !/^[a-f0-9]{64}$/.test(options.expectedDigest ?? '')) throw new Error('Apply requires the reviewed post-drain digest');
  return options;
}
/** Injected ports keep imports and fixture previews entirely disconnected from real accounts. */
export async function runCreditMigration(options, { pool, readProof, migration }) {
  const proof = await readProof(options.proofPath);
  if (proof.ownerId !== options.ownerId || proof.environment !== options.environment || proof.actor !== options.actor || proof.reference !== options.reference) throw new Error('Reviewed proof does not match the requested account and batch');
  if (options.action === 'preview') return migration.previewCreditMigration(pool, proof);
  if (!options.apply) throw new Error('Explicit mutation authorization is required');
  if (options.action === 'drain') return migration.beginCreditMigration(pool, proof);
  if (options.action === 'apply') return migration.applyCreditMigration(pool, proof, options.expectedDigest);
  throw new Error('Unknown migration action');
}
async function loadMigration() {
  const { build } = await import('esbuild');
  const outfile = join(root, 'output/admin', `credits-migration-${randomUUID()}.mjs`);
  await mkdir(dirname(outfile), { recursive: true });
  try {
    await build({ absWorkingDir: root, entryPoints: [join(root, 'src/lib/credits/credit-migration.ts')], outfile, bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', logLevel: 'silent' });
    return await import(pathToFileURL(outfile).href);
  } finally { await unlink(outfile).catch(() => undefined); }
}
async function main() {
  const options = parseCreditMigrationArguments(process.argv.slice(2));
  // No DATABASE_URL fallback and no dotenv import: even preview is a separately authorised account read.
  const connectionString = process.env[options.databaseEnv];
  if (!connectionString) throw new Error('An explicitly selected migration database is required');
  const migration = await loadMigration();
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const result = await runCreditMigration(options, { pool, migration, readProof: async path => JSON.parse(await readFile(resolve(path), 'utf8')) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await pool.end(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch { process.stderr.write('Credits migration refused. Review account scope, proof, phase and digest; no automatic retry.\n'); process.exitCode = 1; }
}
