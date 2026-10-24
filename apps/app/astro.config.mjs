import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { createBuildPlan, prepareBuildInputs, targetIntegration } from '../../scripts/build-target.mjs';

// Independent of marketing Markdown plugins and CMS publication validation.
const root = fileURLToPath(new URL('../../', import.meta.url));
const site = JSON.parse(readFileSync(new URL('../../src/content/settings/site.json', import.meta.url), 'utf8'));
const plan = createBuildPlan(root, 'app'); prepareBuildInputs(plan); const boundary = targetIntegration(plan);
export default defineConfig({
  root, site: site.canonicalOrigin, trailingSlash: 'never', output: 'server', adapter: vercel(),
  srcDir: plan.srcDir, outDir: plan.outDir, publicDir: plan.publicDir, cacheDir: './node_modules/.astro-target-cache/app',
  build: { assets: plan.assets }, integrations: [react(), boundary],
  vite: { envDir: plan.envDir, plugins: [tailwindcss(), boundary.vitePlugin], define: { 'import.meta.env.BUILD_TARGET': JSON.stringify('app') } },
});
