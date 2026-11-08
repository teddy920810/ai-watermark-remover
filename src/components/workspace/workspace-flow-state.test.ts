import { describe, expect, it } from 'vitest';
import { preparationReducer, quoteReducer, type PreparationState, type QuoteState } from './workspace-flow-state';
import type { PublicQuote } from './workspace-api';

const quote = { id: 'original-quote', expiresAt: '2026-11-01T00:00:00Z' } as PublicQuote;
const ready: QuoteState = { phase: 'quoted', quote };

describe('workspace preparation transitions', () => {
  it('retries and stops without retaining a failure or upload progress', () => {
    let state: PreparationState = { phase: 'failed' };
    state = preparationReducer(state, { type: 'start', message: 'Preparing your file' });
    state = preparationReducer(state, { type: 'stage', message: 'Uploading your file' });
    state = preparationReducer(state, { type: 'progress', value: 50 });
    expect(state).toEqual({ phase: 'working', message: 'Uploading your file', progress: 50 });
    state = preparationReducer(state, { type: 'fail' });
    expect(state).toEqual({ phase: 'failed' });
    expect(preparationReducer(state, { type: 'reset' })).toEqual({ phase: 'idle' });
    expect(preparationReducer({ phase: 'idle' }, { type: 'progress', value: 90 })).toEqual({ phase: 'idle' });
  });
});

describe('workspace quote and confirmation transitions', () => {
  it('invalidates a quoted price before preparing another selection', () => {
    const state = quoteReducer(ready, { type: 'stage', message: 'Preparing your selection' });
    expect(state).toEqual({ phase: 'preparing', message: 'Preparing your selection' });
    expect(quoteReducer(state, { type: 'fail' })).toEqual({ phase: 'failed' });
    expect(quoteReducer(state, { type: 'ready', quote })).toEqual(ready);
  });
  it('locks the original quote during submission and uncertainty, even when expired', () => {
    const submitting = quoteReducer(ready, { type: 'submit' });
    expect(submitting).toEqual({ phase: 'submitting', quote });
    for (const state of [submitting, quoteReducer(submitting, { type: 'uncertain' })]) {
      expect(quoteReducer(state, { type: 'reset' })).toBe(state);
      expect(quoteReducer(state, { type: 'ready', quote: { ...quote, id: 'replacement' } })).toBe(state);
      expect(quoteReducer(state, { type: 'stage', message: 'Calculating cost' })).toBe(state);
      expect(quoteReducer(state, { type: 'fail' })).toBe(state);
    }
  });
  it('restores an uncertain confirmation and retains its identity while checking it', () => {
    const state = quoteReducer({ phase: 'idle' }, { type: 'restore', quote });
    expect(state).toEqual({ phase: 'uncertain', quote });
    expect(quoteReducer(state, { type: 'submit' })).toBe(state);
    expect(quoteReducer(state, { type: 'accepted' })).toEqual({ phase: 'idle' });
  });
  it('releases a definite rejection for the existing retry path without inventing a quote', () => {
    const rejected = quoteReducer({ phase: 'uncertain', quote }, { type: 'rejected' });
    expect(rejected).toEqual(ready);
    expect(quoteReducer(rejected, { type: 'reset' })).toEqual({ phase: 'idle' });
    expect(quoteReducer({ phase: 'idle' }, { type: 'uncertain' })).toEqual({ phase: 'idle' });
  });
});
