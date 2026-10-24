import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { replaceMissingBlogImages } from './src/lib/content/remark-missing-blog-images';
import { optimizeBlogImages } from './src/lib/content/remark-optimized-blog-images';
import { createBuildPlan, prepareBuildInputs, targetIntegration } from './scripts/build-target.mjs';

const siteSettings = JSON.parse(readFileSync(new URL('./src/content/settings/site.json', import.meta.url), 'utf8'));
const blogContentDirectory = fileURLToPath(new URL('./src/content/blog', import.meta.url));
const publicDirectory = fileURLToPath(new URL('./public', import.meta.url));
const target = process.env.BUILD_TARGET || 'combined';
if (!['combined', 'site', 'app'].includes(target)) throw new Error('BUILD_TARGET must be combined, site or app');
const plan = target === 'combined' ? null : createBuildPlan(fileURLToPath(new URL('./', import.meta.url)), target);
if (plan) prepareBuildInputs(plan);
const boundary = plan ? targetIntegration(plan) : null;

export default defineConfig({
  site: siteSettings.canonicalOrigin,
  trailingSlash: 'never',
  output: plan?.output ?? 'server',
  adapter: plan?.target === 'site' ? undefined : vercel(),
  integrations: [react(), ...(boundary ? [boundary] : [])],
  ...(plan ? { srcDir: plan.srcDir, outDir: plan.outDir, publicDir: plan.publicDir, cacheDir: `./node_modules/.astro-target-cache/${target}`, build: { assets: plan.assets } } : {}),
  markdown: {
    processor: unified({
      remarkPlugins: [
        [replaceMissingBlogImages, { blogDirectory: blogContentDirectory, publicDirectory }],
        [optimizeBlogImages, { blogDirectory: blogContentDirectory }],
      ],
    }),
  },
  vite: { plugins: [tailwindcss(), ...(boundary ? [boundary.vitePlugin] : [])], ...(plan?.target === 'site' ? { envDir: plan.envDir } : {}), define: { 'import.meta.env.BUILD_TARGET': JSON.stringify(target) } },
});

