import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const [dewatermarkPath, databasePath, r2Path] = process.argv.slice(2);
if (!dewatermarkPath || !databasePath) {
  process.stderr.write('Usage: npm run processing:import -- <dewatermark-key-file> <database-url-file> [s3-info-file]\n');
  process.exit(1);
}

function labelledValue(contents, names) {
  const canonicalNames = new Set(names.map((name) => name.toLowerCase().replace(/[\s_-]/g, '')));
  for (const line of contents.split(/\r?\n/)) {
    const labelled = line.match(/^\s*([^:=：]+?)\s*[:=：]\s*(.*?)\s*$/);
    if (!labelled) continue;
    const label = labelled[1].toLowerCase().replace(/[\s_-]/g, '');
    if (canonicalNames.has(label)) return labelled[2].replace(/^['"]|['"]$/g, '');
  }
}

function valueFromFile(contents, names) {
  const labelled = labelledValue(contents, names);
  if (labelled !== undefined) return labelled;
  return contents.trim().replace(/^['"]|['"]$/g, '');
}

const dewatermarkContents = await readFile(path.resolve(dewatermarkPath), 'utf8');
const databaseContents = await readFile(path.resolve(databasePath), 'utf8');
const apiKey = valueFromFile(dewatermarkContents, ['DEWATERMARK_API_KEY', 'API_KEY']);
const databaseUrl = valueFromFile(databaseContents, ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED']);

if (!apiKey || /\s/.test(apiKey)) throw new Error('The Dewatermark key file is invalid.');
const parsedDatabaseUrl = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) || !parsedDatabaseUrl.hostname) {
  throw new Error('The database URL file is invalid.');
}

const envPath = path.join(process.cwd(), '.env.local');
let existingEnv = '';
try {
  existingEnv = await readFile(envPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const managed = new Map([
  ['DEWATERMARK_API_KEY', apiKey],
  ['DATABASE_URL', databaseUrl],
]);

if (r2Path) {
  const r2Contents = await readFile(path.resolve(r2Path), 'utf8');
  const accountId = labelledValue(r2Contents, ['ACCOUNT_ID', 'R2_ACCOUNT_ID']);
  const accessKeyId = labelledValue(r2Contents, ['ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID']);
  const secretAccessKey = labelledValue(r2Contents, ['SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY']);
  const endpoint = labelledValue(r2Contents, ['S3_API_ENDPOINT', 'R2_ENDPOINT']);
  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error('The S3 info file is missing required R2 fields.');
  }
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== 'https:' || !parsedEndpoint.hostname) {
    throw new Error('The R2 endpoint is invalid.');
  }
  managed.set('R2_ACCOUNT_ID', accountId);
  managed.set('R2_ACCESS_KEY_ID', accessKeyId);
  managed.set('R2_SECRET_ACCESS_KEY', secretAccessKey);
  managed.set('R2_ENDPOINT', endpoint);
  managed.set('R2_BUCKET', 'watermark');
}
const unmanagedLines = existingEnv
  .split(/\r?\n/)
  .filter((line) => ![...managed.keys()].some((key) => line.startsWith(`${key}=`)))
  .filter(Boolean);
const managedLines = [...managed].map(([key, value]) => `${key}=${value}`);

await writeFile(envPath, [...unmanagedLines, ...managedLines, ''].join('\n'), { encoding: 'utf8', mode: 0o600 });
process.stdout.write('Processing credentials imported securely. WATERMARK_PROVIDER remains unchanged.\n');
