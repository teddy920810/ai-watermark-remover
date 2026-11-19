import type { Operation } from '../contracts/processing-public';

export interface ProcessingTiming {
  phase: 'preflight' | 'queue' | 'worker-start' | 'provider' | 'save-result';
  operation: Operation | 'image' | 'video' | 'mask' | 'unknown';
  outcome: 'ok' | 'error';
  durationMs: number;
}

export function logProcessingTiming(event: ProcessingTiming) {
  console.info(JSON.stringify({
    event: 'processing_timing',
    phase: event.phase,
    operation: event.operation,
    outcome: event.outcome,
    durationMs: event.durationMs,
  }));
}
