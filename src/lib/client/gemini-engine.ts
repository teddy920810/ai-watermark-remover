import type { LocalMediaInfo } from './free-gemini';
export interface LocalResult { info: LocalMediaInfo; blob?: Blob; bestEffort?: boolean }
export function runGemini(file: File, mode: 'inspect' | 'process', signal: AbortSignal, progress: (stage: string, value?: number) => void = () => {}): Promise<LocalResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gemini-worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Processing cancelled', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error('The local processor could not load. Reload this page to try again.')); };
    worker.onmessage = (event: MessageEvent<LocalResult & { stage?: string; progress?: number; error?: string }>) => {
      if (event.data.stage) { progress(event.data.stage, event.data.progress); return; }
      finish();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data);
    };
    worker.postMessage({ file, mode });
  });
}
