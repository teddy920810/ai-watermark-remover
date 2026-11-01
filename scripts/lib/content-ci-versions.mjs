import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { parseCmsDocument } from './cms-document.mjs';

/** Read candidate and previous content from the event's exact Git objects. */
export function readContentVersions(base, head, file, cwd = process.cwd()) {
  if (![base, head].every(ref => /^[a-f0-9]{40}$/.test(ref ?? '')) || !/^src\/content\/(?:blog\/[^/]+\.md|landing-pages\/[^/]+\.json)$/.test(file)) throw new Error('Exact content revisions are required');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 4_000_000 });
    if (result.error || result.status !== 0) throw new Error('Content revision is unavailable');
    return result.stdout;
  };
  const read = ref => {
    const tree = git('ls-tree', '-z', ref, '--', file);
    if (!tree) return undefined;
    if (!tree.startsWith('100644 blob ') || tree.slice(tree.indexOf('\t') + 1, -1) !== file) throw new Error('Content must be a regular file');
    const parsed = parseCmsDocument(file, git('show', `${ref}:${file}`));
    return { data: parsed.data, body: parsed.body ?? '' };
  };
  const current = read(head);
  if (!current) throw new Error('Candidate content is missing');
  return { current, previous: read(base) };
}
