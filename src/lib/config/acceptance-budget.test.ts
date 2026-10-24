import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcceptanceBudget } from '../../../scripts/lib/acceptance-budget.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function budget() {
  const directory = await mkdtemp(join(tmpdir(), 'watermark-budget-'));
  directories.push(directory);
  return { file: join(directory, 'budget.json'), directory };
}

describe('real acceptance budget', () => {
  it('records an explicitly authorized increase to eight image requests without changing the video cap', async () => {
    const { file } = await budget();
    const ledger = new AcceptanceBudget(file);
    await ledger.reserve('image', 'ordinary sample');
    await ledger.authorizeIncrease({ image: 8, video: 5 }, 'User approved eight image calls on 2026-10-24');
    const authorized = new AcceptanceBudget(file, { image: 8, video: 5 });
    expect((await authorized.summary()).remaining).toEqual({ image: 7, video: 5 });
    expect(JSON.parse(await readFile(file, 'utf8')).authorizations).toHaveLength(1);
    await expect(authorized.authorizeIncrease({ image: 8, video: 6 }, 'unsupported')).rejects.toThrow(/limits/i);
  });
  it('counts an uncertain request before network work and never restores its allowance', async () => {
    const { file } = await budget();
    const ledger = new AcceptanceBudget(file, { image: 1, video: 1 });
    const id = await ledger.reserve('image', 'ordinary image contract');
    await ledger.finish(id, { status: 'unknown', note: 'response timed out' });
    await expect(new AcceptanceBudget(file, { image: 1, video: 1 }).reserve('image', 'retry')).rejects.toThrow(/budget/i);
    const summary = await ledger.summary();
    expect(summary.used).toEqual({ image: 1, video: 0 });
    expect(summary.remaining).toEqual({ image: 0, video: 1 });
  });

  it('admits only five concurrent image requests and keeps the independent video allowance', async () => {
    const { file } = await budget();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => new AcceptanceBudget(file).reserve('image', `sample ${index}`)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    const ledger = new AcceptanceBudget(file);
    expect((await ledger.summary()).remaining.video).toBe(5);
    await ledger.reserve('video', 'video fixed mask');
    expect((await ledger.summary()).used).toEqual({ image: 5, video: 1 });
  });

  it('persists only allowed evidence fields and rejects attempts to silently expand a previous budget', async () => {
    const { file } = await budget();
    const ledger = new AcceptanceBudget(file, { image: 2, video: 2 });
    const id = await ledger.reserve('image', 'PRO sample');
    await ledger.finish(id, { status: 'passed', note: 'JPEG verified', apiKey: 'private', url: 'https://example.test/?secret=private' });
    const source = await readFile(file, 'utf8');
    expect(source).not.toContain('private');
    expect(source).not.toContain('example.test');
    await expect(new AcceptanceBudget(file, { image: 5, video: 5 }).reserve('image', 'expanded')).rejects.toThrow(/limits/i);
  });
});
