import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { updateContentBaseline } from '../../../scripts/update-content-baseline.mjs';
import { contentHash, projectContent } from '../../../scripts/lib/content-baseline.mjs';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'content-approval-')); roots.push(root);
  await mkdir(join(root, 'tests/fixtures'), { recursive: true }); await mkdir(join(root, 'src/content'), { recursive: true });
  const file = 'src/content/example.json'; const before = JSON.stringify({ image: '/uploads/original.png', alt: 'Original alt' });
  await writeFile(join(root, file), before);
  const baseline = { base: 'original-ref', files: [{ file, semanticSha256: contentHash(projectContent(file, before)), images: [] }] };
  await writeFile(join(root, 'tests/fixtures/seo-content-baseline.json'), JSON.stringify(baseline));
  return { root, file, baseline, fixturePath: join(root, 'tests/fixtures/seo-content-baseline.json') };
}
describe('explicit content-owner baseline updates', () => {
  it('refuses a missing, cross-repository or invalid approval reference without changing the baseline', async () => {
    const f = await fixture(); const before = await readFile(f.fixturePath, 'utf8');
    for (const approval of ['', 'https://github.com/other/repo/pull/1', 'https://github.com/teddy920810/ai-watermark-remover/pull/0']) await expect(updateContentBaseline({ root: f.root, approval, files: [f.file] })).rejects.toThrow();
    expect(await readFile(f.fixturePath, 'utf8')).toBe(before);
  });
  it('updates only an explicitly named baseline and records the review reference while never rewriting content', async () => {
    const f = await fixture(); const content = JSON.stringify({ image: '/uploads/content-owner-selected.png', alt: 'Content owner approved alt' });
    await writeFile(join(f.root, f.file), content);
    const approval = 'https://github.com/teddy920810/ai-watermark-remover/pull/123#issuecomment-456';
    await updateContentBaseline({ root: f.root, approval, files: [f.file] });
    const actual = JSON.parse(await readFile(f.fixturePath, 'utf8'));
    expect(actual.base).toBe('original-ref');
    expect(actual.files[0]).toMatchObject({ semanticSha256: contentHash(projectContent(f.file, content)), contentOwnerApproval: approval });
    expect(actual.files[0].images).toContainEqual({ path: '/alt', value: 'Content owner approved alt' });
    expect(await readFile(join(f.root, f.file), 'utf8')).toBe(content);
    const baseline = await readFile(f.fixturePath, 'utf8');
    await expect(updateContentBaseline({ root: f.root, approval, files: [f.file, '../outside.json'] })).rejects.toThrow();
    expect(await readFile(f.fixturePath, 'utf8')).toBe(baseline);
  });
});
