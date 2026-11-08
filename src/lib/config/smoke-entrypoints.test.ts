import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import * as budget from '../../../scripts/lib/acceptance-budget.mjs';

describe('single public and functional smoke entries', () => {
  it('retires the unused budget executor while retaining the reviewed aggregate', () => {
    expect(budget).not.toHaveProperty('AcceptanceBudget');
    expect(budget.CreditsAcceptanceBudget).toBeTypeOf('function');
  });

  it('keeps manual and scheduled CI public without installation or authentication secrets', async () => {
    const workflow = parse(await readFile('.github/workflows/production-smoke.yml', 'utf8'));
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on.schedule).toEqual([{ cron: '17 2 * * *' }]);
    expect(workflow.on.workflow_dispatch?.inputs).toBeUndefined();
    const steps = workflow.jobs.smoke.steps;
    expect(steps.filter((step: { run?: string }) => step.run).map((step: { run: string }) => step.run)).toEqual(['node scripts/production-smoke.mjs']);
    // An apex redirect retains POST Origin and would trigger the application's 403 guard.
    expect(steps.find((step: { run?: string }) => step.run)?.env?.SMOKE_BASE_URL).toBe('https://www.watermarkgemini.com');
    expect(JSON.stringify(workflow)).not.toMatch(/SMOKE_SESSION_COOKIE|functional_operation|\$\{\{\s*secrets\./);
  });

  it('routes existing operation shortcuts to the canonical budget-controlled runner', async () => {
    const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
    for (const operation of ['background-removal', 'object-removal']) {
      expect(scripts[`test:smoke:${operation}`]).toBe(`node scripts/processing-acceptance.mjs --functional --operation ${operation}`);
    }
  });

  it('runs the public CLI standalone and rejects functional flags before any request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'public-smoke-entry-'));
    const calls: { path: string; cookie?: string }[] = [];
    const server = createServer((request, response) => {
      calls.push({ path: request.url ?? '', cookie: request.headers.cookie });
      response.writeHead(request.url?.startsWith('/api/') ? 401 : 200);
      response.end('{}');
    });
    try {
      await copyFile('scripts/production-smoke.mjs', join(directory, 'public.mjs'));
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local smoke fixture did not start');
      const run = (args: string[]) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [join(directory, 'public.mjs'), ...args], {
          cwd: directory, shell: false, windowsHide: true,
          env: { ...process.env, SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`, SMOKE_SESSION_COOKIE: 'fixture=never-send', PROCESSING_ACCEPTANCE_SESSION_COOKIE: 'fixture=never-send' },
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('error', reject);
        child.on('close', code => resolve({ code, output }));
      });
      const publicRun = await run([]);
      expect(publicRun.code, publicRun.output).toBe(0);
      expect(calls.map(call => call.path)).toEqual(['/', '/robots.txt', '/sitemap.xml', '/api/v1/uploads', '/api/me/benefits', '/api/me/check-in']);
      expect(calls.every(call => !call.cookie)).toBe(true);
      calls.length = 0;
      const rejected = await run(['--require-auth']);
      expect(rejected.code).not.toBe(0);
      expect(rejected.output).toContain('processing-acceptance.mjs');
      expect(calls).toHaveLength(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
