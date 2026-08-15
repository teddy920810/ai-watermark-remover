import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildSiteInitializationPlan, parseSiteInitConfig } from './site-initializer.mjs';

const managedPaths = ['package.json', '.env.example', 'src/content/settings/site.json'];
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const configArgument = args.find((argument) => !argument.startsWith('--'));

if (!configArgument) {
  throw new Error('Usage: npm run site:init -- site.config.json [--apply]');
}

const root = process.cwd();
const configPath = path.resolve(root, configArgument);
const config = parseSiteInitConfig(JSON.parse(await readFile(configPath, 'utf8')));
const files = Object.fromEntries(await Promise.all(managedPaths.map(async (relativePath) => [
  relativePath,
  await readFile(path.join(root, relativePath), 'utf8'),
])));
const plan = buildSiteInitializationPlan(config, files);

process.stdout.write(`New site: ${config.siteName} (${config.siteUrl})\n`);
process.stdout.write(`Files: ${Object.keys(plan).join(', ')}\n`);

if (!apply) {
  process.stdout.write('Preview only. Re-run with --apply after reviewing site.config.json.\n');
  process.exit(0);
}

const backupRoot = path.join(root, '.site-init-backup', new Date().toISOString().replaceAll(':', '-'));
for (const [relativePath, content] of Object.entries(plan)) {
  const backupPath = path.join(backupRoot, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, files[relativePath], 'utf8');
  await writeFile(path.join(root, relativePath), content, 'utf8');
}

process.stdout.write(`Applied. Previous files were copied to ${path.relative(root, backupRoot)}.\n`);
process.stdout.write('Next: upload brand assets, rewrite content in Pages CMS, configure deployment secrets, and run npm run verify.\n');
