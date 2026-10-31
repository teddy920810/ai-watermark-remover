import { describe, expect, it } from 'vitest';
import { canConfirmQuote, canRefineResult, canSubmitConfirmation, creditLabel, jobIsActive, processingLabel } from './workspace-state';
describe('workspace processing safeguards', () => {
  it('keeps purchased image credits distinct from free uses and administrator processing credits', () => {
    expect(creditLabel(100, 'purchasedImageCredits')).toBe('100 image credits');
    expect(creditLabel(1, 'purchasedImageCredits')).toBe('1 image credit');
    expect(creditLabel(1, 'freeUses')).toBe('1 free image use');
    expect(creditLabel(3, 'processingCredits')).toBe('3 processing credits');
  });
  it('requires a current quote and explicit confirmation', () => {
    expect(canConfirmQuote(null, false, 100)).toBe(false);
    expect(canConfirmQuote({ expiresAt: new Date(99).toISOString() }, false, 100)).toBe(false);
    expect(canConfirmQuote({ expiresAt: new Date(101).toISOString() }, true, 100)).toBe(false);
    expect(canConfirmQuote({ expiresAt: new Date(101).toISOString() }, false, 100)).toBe(true);
  });
  it('keeps unknown submissions recoverable without a paid replay', () => {
    expect(jobIsActive('UNKNOWN')).toBe(false);
    expect(processingLabel('UNKNOWN')).toMatch(/checking|confirm/i);
    expect(jobIsActive('SAVING')).toBe(true);
    expect(jobIsActive('READY')).toBe(false);
  });
  it('recovers the same uncertain confirmation even after its reservation reduced the balance', () => {
    const expired = { expiresAt: new Date(99).toISOString() };
    expect(canSubmitConfirmation(expired, false, true, true, 100)).toBe(true);
    expect(canSubmitConfirmation(expired, false, true, false, 100)).toBe(false);
    expect(canSubmitConfirmation(expired, true, false, true, 100)).toBe(false);
  });
  it('only offers refinement for a compatible ready image', () => {
    expect(canRefineResult({ status: 'READY', operation: 'image-watermark', result: { canRefine: true } })).toBe(true);
    expect(canRefineResult({ status: 'READY', operation: 'image-watermark-pro', result: { canRefine: false } })).toBe(false);
    expect(canRefineResult({ status: 'READY', operation: 'video-watermark', result: { canRefine: true } })).toBe(false);
    expect(canRefineResult({ status: 'FAILED', operation: 'image-watermark', result: { canRefine: true } })).toBe(false);
  });
});
