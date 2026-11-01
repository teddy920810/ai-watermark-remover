import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectContent, contentHash, contentImages } from './lib/content-baseline.mjs';

/** An audit reference is not authorization; the content owner must approve the referenced diff first. */
export async function updateContentBaseline({ root = process.cwd(), approval, files }) {
  if (!/^https:\/\/github\.com\/teddy920810\/ai-watermark-remover\/pull\/[1-9]\d*(?:#(?:issuecomment|pullrequestreview)-[1-9]\d*)?$/.test(approval ?? '') || !Array.isArray(files) || !files.length) throw new Error('Provide the content-owner approval PR and exact approved content files');
  const filename = resolve(root, 'tests/fixtures/seo-content-baseline.json');
  const baseline = JSON.parse(await readFile(filename, 'utf8'));
  const updates = [];
  for (const file of new Set(files)) {
    const record = baseline.files.find(entry => entry.file === file);
    if (!record) throw new Error('Only existing protected content can update its reviewed baseline');
    const data = projectContent(file, await readFile(resolve(root, file), 'utf8'));
    updates.push({ record, data });
  }
  for (const { record, data } of updates) Object.assign(record, { semanticSha256: contentHash(data), images: contentImages(data), contentOwnerApproval: approval });
  await writeFile(filename, JSON.stringify(baseline, null, 2) + '\n');
  return updates.map(update => update.record.file);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] !== '--approval') throw new Error('Use --approval APPROVED_PR_URL followed by exact content paths');
  const changed = await updateContentBaseline({ approval: args[1], files: args.slice(2) });
  process.stdout.write(`Updated ${changed.length} approved test baselines; review and commit this fixture with the content PR.\n`);
}
