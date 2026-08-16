import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourcePath = process.argv[2];
if (!sourcePath) {
  process.stderr.write('Usage: npm run auth:import -- <path-to-google-client-secret.json>\n');
  process.exit(1);
}

const projectRoot = process.cwd();
const secretsDirectory = path.join(projectRoot, '.secrets');
const storedCredentialPath = path.join(secretsDirectory, 'google-oauth-client.json');
const envPath = path.join(projectRoot, '.env.local');
const sourceContents = await readFile(path.resolve(sourcePath), 'utf8');
const credential = JSON.parse(sourceContents);
const webCredential = credential.web;

if (!webCredential?.client_id || !webCredential?.client_secret) {
  throw new Error('The selected file is not a Google OAuth Web client credential.');
}

await mkdir(secretsDirectory, { recursive: true });
await copyFile(path.resolve(sourcePath), storedCredentialPath);

let existingEnv = '';
try {
  existingEnv = await readFile(envPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const currentValues = new Map();
for (const line of existingEnv.split(/\r?\n/)) {
  const separator = line.indexOf('=');
  if (separator > 0) currentValues.set(line.slice(0, separator), line.slice(separator + 1));
}

currentValues.set('GOOGLE_CLIENT_ID', webCredential.client_id);
currentValues.set('GOOGLE_CLIENT_SECRET', webCredential.client_secret);
currentValues.set('BETTER_AUTH_URL', 'http://localhost:4321');
if (!currentValues.get('BETTER_AUTH_SECRET')) {
  currentValues.set('BETTER_AUTH_SECRET', randomBytes(32).toString('base64url'));
}

const managedKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'];
const unmanagedLines = existingEnv
  .split(/\r?\n/)
  .filter((line) => !managedKeys.some((key) => line.startsWith(`${key}=`)))
  .filter(Boolean);
const managedLines = managedKeys.map((key) => `${key}=${currentValues.get(key)}`);

await writeFile(envPath, [...unmanagedLines, ...managedLines, ''].join('\n'), { encoding: 'utf8', mode: 0o600 });

process.stdout.write('Google OAuth credentials imported securely.\n');
process.stdout.write('Local callback: http://localhost:4321/api/auth/callback/google\n');

