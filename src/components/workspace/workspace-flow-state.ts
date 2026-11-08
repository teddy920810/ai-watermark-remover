import type { PublicQuote } from './workspace-api';

export type PreparationState = { phase: 'idle' | 'failed' } | { phase: 'working'; message: string; progress: number };
export type PreparationAction = { type: 'start' | 'stage'; message: string } | { type: 'progress'; value: number } | { type: 'reset' | 'fail' };
export function preparationReducer(state: PreparationState, action: PreparationAction): PreparationState {
  switch (action.type) {
    case 'start': return { phase: 'working', message: action.message, progress: 0 };
    case 'stage': return { phase: 'working', message: action.message, progress: state.phase === 'working' ? state.progress : 0 };
    case 'progress': return state.phase === 'working' ? { ...state, progress: action.value } : state;
    case 'fail': return { phase: 'failed' };
    case 'reset': return { phase: 'idle' };
  }
}

export type QuoteState = { phase: 'idle' | 'failed' } | { phase: 'preparing'; message: string } | { phase: 'quoted' | 'submitting' | 'uncertain'; quote: PublicQuote };
export type QuoteAction = { type: 'ready' | 'restore'; quote: PublicQuote } | { type: 'stage'; message: string } | { type: 'submit' | 'uncertain' | 'rejected' | 'accepted' | 'reset' | 'fail' };
export function quoteReducer(state: QuoteState, action: QuoteAction): QuoteState {
  // A late preparation response must never replace a submission's quote/key pair.
  if ((state.phase === 'submitting' || state.phase === 'uncertain')
    && ['reset', 'fail', 'stage', 'ready', 'restore'].includes(action.type)) return state;
  switch (action.type) {
    case 'reset': case 'accepted': return { phase: 'idle' };
    case 'fail': return { phase: 'failed' };
    case 'stage': return { phase: 'preparing', message: action.message };
    case 'ready': return { phase: 'quoted', quote: action.quote };
    case 'restore': return { phase: 'uncertain', quote: action.quote };
    case 'submit': return state.phase === 'quoted' ? { ...state, phase: 'submitting' } : state;
    case 'uncertain': return 'quote' in state ? { ...state, phase: 'uncertain' } : state;
    case 'rejected': return 'quote' in state ? { ...state, phase: 'quoted' } : state;
  }
}
