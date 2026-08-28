import pg from 'pg';
import process from 'node:process';

const apiKey = process.env.DEWATERMARK_API_KEY;
const databaseUrl = process.env.DATABASE_URL;
if (!apiKey || !databaseUrl) throw new Error('DEWATERMARK_API_KEY and DATABASE_URL are required.');

let failed = false;
try {
  const creditResponse = await globalThis.fetch('https://platform.dewatermark.ai/api/creditInfo', {
    headers: { 'X-API-KEY': apiKey },
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!creditResponse.ok) throw new Error(`status ${creditResponse.status}`);
  const creditBody = await creditResponse.json();
  const availableCredit = creditBody?.data?.available_credit;
  if (typeof availableCredit !== 'number') throw new Error('invalid response');
  process.stdout.write(`Dewatermark credential: valid; available credits: ${availableCredit}.\n`);
} catch (error) {
  failed = true;
  process.stderr.write(`Dewatermark credential check failed: ${error.message}.\n`);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 15_000 });
try {
  const result = await pool.query('SELECT 1 AS connected');
  if (result.rows[0]?.connected !== 1) throw new Error('invalid response');
  process.stdout.write('Neon database: read-only connection passed.\n');
} catch (error) {
  failed = true;
  process.stderr.write(`Neon connection check failed: ${error.message}.\n`);
} finally {
  await pool.end();
}

if (failed) process.exitCode = 1;
