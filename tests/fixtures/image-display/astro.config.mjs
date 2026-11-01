import { defineConfig } from 'astro/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../public/', import.meta.url)),
  devToolbar: { enabled: false },
});
