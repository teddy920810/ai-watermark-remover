import { dev } from 'astro';
import process from 'node:process';

// Keep ignored archives and generated outputs out of the E2E source watcher.
const server = await dev({
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 4379 },
  vite: { server: { watch: { ignored: ['**/.tools/**', '**/dist/**', '**/dist-target/**', '**/.vercel/**', '**/output/**', '**/coverage/**', '**/test-results/**', '**/playwright-report/**'] } } },
});
const stop = async () => { await server.stop(); process.exit(0); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
