import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../../../scripts/import-processing-config.mjs', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('processing credential import', () => {
  it('removes human-readable labels with ASCII or full-width colons', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'processing-import-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'dewatermark.txt'), 'api-key ： test-api-key\n', 'utf8');
    await writeFile(
      path.join(directory, 'nero.txt'),
      'database_url: postgresql://user:password@example.neon.tech/database?sslmode=require\n',
      'utf8',
    );

    await execute(process.execPath, [scriptPath, 'dewatermark.txt', 'nero.txt'], { cwd: directory });
    const imported = await readFile(path.join(directory, '.env.local'), 'utf8');

    expect(imported).toContain('DEWATERMARK_API_KEY=test-api-key\n');
    expect(imported).toContain(
      'DATABASE_URL=postgresql://user:password@example.neon.tech/database?sslmode=require\n',
    );
    expect(imported).not.toContain('api-key ：');
    expect(imported).not.toContain('database_url:');
  });

  it('imports labelled R2 credentials when an optional S3 info file is provided', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'processing-import-r2-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'dewatermark.txt'), 'test-api-key\n', 'utf8');
    await writeFile(
      path.join(directory, 'nero.txt'),
      'postgresql://user:password@example.neon.tech/database?sslmode=require\n',
      'utf8',
    );
    await writeFile(
      path.join(directory, 'S3-info.txt'),
      [
        'Account ID: account-id',
        'Access Key ID: access-key-id',
        'Secret Access Key: secret-access-key',
        'S3 API endpoint: https://account-id.r2.cloudflarestorage.com',
      ].join('\n'),
      'utf8',
    );

    await execute(process.execPath, [scriptPath, 'dewatermark.txt', 'nero.txt', 'S3-info.txt'], { cwd: directory });
    const imported = await readFile(path.join(directory, '.env.local'), 'utf8');

    expect(imported).toContain('R2_ACCOUNT_ID=account-id\n');
    expect(imported).toContain('R2_ACCESS_KEY_ID=access-key-id\n');
    expect(imported).toContain('R2_SECRET_ACCESS_KEY=secret-access-key\n');
    expect(imported).toContain('R2_ENDPOINT=https://account-id.r2.cloudflarestorage.com\n');
    expect(imported).toContain('R2_BUCKET=watermark\n');
  });
});
