import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const siteSettings = JSON.parse(readFileSync(new URL('./src/content/settings/site.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: siteSettings.canonicalOrigin,
  trailingSlash: 'never',
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});

