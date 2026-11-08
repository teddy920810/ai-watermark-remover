import { describe, expect, it } from 'vitest';
import { createGeminiEvents } from './gemini-events';
import { readFileSync } from 'node:fs';

describe('free Gemini analytics boundary', () => {
  it('uses the existing official Google queue shape only in production', () => {
    const page = readFileSync(new URL('../../pages/app/free/gemini.astro', import.meta.url), 'utf8');
    expect(page).toContain('import.meta.env.PROD');
    expect(page).toContain('function gtag(){dataLayer.push(arguments);}');
    expect(page).toContain("gtag('js', new Date());");
    expect(page).toContain("gtag('config', analyticsId);");
    expect(page).not.toContain('function gtag(...');
  });
  it('deduplicates per-result download/paid events and exports only a fixed safe payload', () => {
    const events: unknown[] = [];
    const emit = createGeminiEvents((name, payload) => events.push([name, payload]));
    emit('result', 'image', 'run-a', 101.8);
    emit('download_started', 'image', 'run-a'); emit('download_started', 'image', 'run-a');
    emit('paid_entry', 'image', 'run-a'); emit('paid_entry', 'image', 'run-a');
    expect(events).toEqual([
      ['gemini_free_result', { media_kind: 'image', run_id: 'run-a', elapsed_ms: 102 }],
      ['gemini_free_download_started', { media_kind: 'image', run_id: 'run-a' }],
      ['gemini_free_paid_entry', { media_kind: 'image', run_id: 'run-a' }],
    ]);
  });
});
