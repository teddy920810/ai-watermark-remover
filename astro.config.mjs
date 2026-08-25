import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { replaceMissingBlogImages } from './src/lib/content/remark-missing-blog-images';
import { optimizeBlogImages } from './src/lib/content/remark-optimized-blog-images';

const siteSettings = JSON.parse(readFileSync(new URL('./src/content/settings/site.json', import.meta.url), 'utf8'));
const blogContentDirectory = fileURLToPath(new URL('./src/content/blog', import.meta.url));
const publicDirectory = fileURLToPath(new URL('./public', import.meta.url));

export default defineConfig({
  site: siteSettings.canonicalOrigin,
  trailingSlash: 'never',
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  markdown: {
    processor: unified({
      remarkPlugins: [
        [replaceMissingBlogImages, { blogDirectory: blogContentDirectory, publicDirectory }],
        [optimizeBlogImages, { blogDirectory: blogContentDirectory }],
      ],
    }),
  },
  vite: { plugins: [tailwindcss()] },
});

