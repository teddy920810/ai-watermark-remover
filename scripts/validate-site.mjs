import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { collectSiteValidationIssues } from './site-validator.mjs';

const root = process.cwd();

async function walkFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? walkFiles(relativePath) : [relativePath.replaceAll('\\', '/')];
  }));
  return nested.flat();
}

const contentPaths = (await walkFiles('src/content')).filter((file) => /\.(?:json|md|mdx)$/.test(file));
const contentDocuments = await Promise.all(contentPaths.map(async (file) => {
  const source = await readFile(path.join(root, file), 'utf8');
  return { path: file, value: file.endsWith('.json') ? JSON.parse(source) : source };
}));

const landingDocuments = contentDocuments.filter(({ path: file }) => file.startsWith('src/content/landing-pages/') && file.endsWith('.json'));
const landingSlugs = landingDocuments.map(({ value }) => value.slug);
const blogDocuments = contentDocuments.filter(({ path: file }) => file.startsWith('src/content/blog/'));
const blogSlugs = blogDocuments.map(({ value, path: file }) => {
  const slug = value.match(/^slug:\s*([^\r\n]+)$/m)?.[1]?.trim();
  if (!slug) throw new Error(`${file}: slug frontmatter is missing.`);
  return slug;
});
const uploadPaths = await walkFiles('public/uploads');
const availableAssets = uploadPaths.map((file) => `/${file.replace(/^public\//, '')}`);
const envExample = await readFile(path.join(root, '.env.example'), 'utf8');
const siteDocument = contentDocuments.find(({ path: file }) => file === 'src/content/settings/site.json');
if (!siteDocument || typeof siteDocument.value !== 'object' || !siteDocument.value) {
  throw new Error('src/content/settings/site.json is missing.');
}
const canonicalOrigin = siteDocument.value.canonicalOrigin;

const issues = collectSiteValidationIssues({ envExample, canonicalOrigin, contentDocuments, landingSlugs, blogSlugs, availableAssets });
if (issues.length > 0) {
  process.stderr.write(`Site validation failed:\n- ${issues.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Site validation passed for ${contentDocuments.length} content files and ${availableAssets.length} uploaded assets.\n`);
}
