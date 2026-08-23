import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { importDocxBlog } from './lib/docx-blog-import.mjs';

const readOption = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const requiredOption = (name) => {
  const value = readOption(name);
  if (!value) throw new Error(`Missing required option: --${name}`);
  return value;
};

const repositoryRoot = path.resolve(readOption('repo-root') ?? process.cwd());
const blogDirectory = path.join(repositoryRoot, 'src', 'content', 'blog');
const uploadsDirectory = path.join(repositoryRoot, 'public', 'uploads');
const existingFiles = await fs.readdir(blogDirectory);
const existingSlugs = new Set(existingFiles.filter((file) => /\.mdx?$/.test(file)).map((file) => path.parse(file).name));

const report = await importDocxBlog({
  inputPath: path.resolve(requiredOption('input')),
  outputDirectory: blogDirectory,
  uploadsDirectory,
  slug: requiredOption('slug'),
  seoTitle: readOption('seo-title'),
  publishedAt: readOption('published-at') ?? new Date().toISOString().slice(0, 10),
  existingSlugs,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
