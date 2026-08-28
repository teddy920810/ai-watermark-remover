import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const migrationsDirectory = resolve('db', 'migrations');
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
  .sort((left, right) => left.localeCompare(right));
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [820260829]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await client.query('SELECT name FROM schema_migrations');
  const appliedNames = new Set(applied.rows.map((row) => row.name));
  let appliedCount = 0;
  for (const file of migrationFiles) {
    if (appliedNames.has(file)) continue;
    await client.query(await readFile(resolve(migrationsDirectory, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    appliedCount += 1;
  }
  await client.query('COMMIT');
  process.stdout.write(`Database migrations complete; applied ${appliedCount}, total ${migrationFiles.length}.\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
