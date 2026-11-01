import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCmsDocument } from './lib/cms-document.mjs';
import { collectPublicationIssues as collectIssues } from './lib/cms-publication-policy.mjs';
export { parseCmsDocument };

import { reservedToolSlugs } from '../src/lib/contracts/route-policy.mjs';

export { reservedToolSlugs };
export function readCmsDocuments(root) {
  const records = [];
  function walk(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (/\.(json|md|mdx)$/.test(entry.name)) records.push(parseCmsDocument(relative, readFileSync(join(root, relative), 'utf8')));
    }
  }
  for (const directory of ['src/content/landing-pages', 'src/content/blog']) walk(directory);
  return records;
}

export function collectPublicationIssues(records, root) {
  return collectIssues(records, root ? pathname => existsSync(resolve(root, 'public', `.${pathname}`)) : undefined);
}

export function assertCmsPublication(root) {
  const issues = collectPublicationIssues(readCmsDocuments(root), root);
  if (issues.length) throw new Error(`CMS publication check failed:\n${issues.join('\n')}`);
}
