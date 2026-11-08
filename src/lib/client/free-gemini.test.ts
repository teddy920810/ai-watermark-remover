import { describe, expect, it } from 'vitest';
import { localOperationCatalog, durableOperationIds } from '../contracts/operation-catalog';
import { paidHandoffReason, handoffIsUsable } from './free-gemini';

describe('free Gemini operation boundary', () => {
  it('offers both authenticated local operations without joining a paid allowance or server queue', () => {
    expect(Object.keys(localOperationCatalog)).toEqual(['gemini-image-free', 'gemini-video-free']);
    for (const operation of Object.values(localOperationCatalog)) {
      expect(operation).toMatchObject({ executor: 'browser', requiresAuthentication: true, charge: 0 });
    }
    expect(durableOperationIds).not.toContain('gemini-video-free');
  });
  it('allows 30fps locally but refuses to advertise a 24fps-only paid handoff', () => {
    expect(localOperationCatalog['gemini-video-free'].capability).not.toHaveProperty('requiredFps');
    const file = { type: 'video/mp4', size: 1000 };
    const capability = { enabled: true, acceptedTypes: ['video/mp4'], maxBytes: 2000, requiredFps: 24, maxDurationSeconds: 540 };
    expect(paidHandoffReason(file, { kind: 'video', fps: 30, durationSeconds: 8, rotation: 0 }, capability)).toMatch(/24 fps/);
    expect(paidHandoffReason(file, { kind: 'video', fps: 24, durationSeconds: 8, rotation: 0 }, capability)).toBeNull();
    expect(paidHandoffReason(file, { kind: 'video', fps: 24, durationSeconds: 8, rotation: 90 }, capability)).toMatch(/rotation/);
    expect(paidHandoffReason(file, { kind: 'video', fps: 24, durationSeconds: 541 }, capability)).toMatch(/duration/);
  });
  it('never enables cloud handoff without live capabilities, or for oversized input', () => {
    expect(paidHandoffReason({ type: 'image/png', size: 1 }, { kind: 'image' })).toMatch(/unavailable/);
    expect(paidHandoffReason({ type: 'image/png', size: 11 }, { kind: 'image' }, { enabled: true, acceptedTypes: ['image/png'], maxBytes: 10 })).toMatch(/size/);
    expect(paidHandoffReason({ type: 'image/png', size: 1 }, { kind: 'image' }, { enabled: true, acceptedTypes: ['image/png'], maxBytes: 10 })).toBeNull();
  });
  it('binds an explicit handoff to its owner, expiry and eligible operation', () => {
    const draft = { ownerId: 'a', expiresAt: 20, handoff: true, kind: 'image', recommendation: { operation: 'image-watermark' } };
    expect(handoffIsUsable(draft, 'a', 19)).toBe(true);
    expect(handoffIsUsable(draft, 'b', 19)).toBe(false);
    expect(handoffIsUsable(draft, undefined, 19)).toBe(false);
    expect(handoffIsUsable(draft, 'a', 20)).toBe(false);
    expect(handoffIsUsable({ ...draft, recommendation: { operation: 'image-watermark-pro' } }, 'a', 19)).toBe(false);
    expect(handoffIsUsable({ ...draft, handoff: false }, 'a', 19)).toBe(false);
  });
});
