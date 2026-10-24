import { describe, expect, it } from 'vitest';
import { draftIsExpired, validateLocalMedia, workspacePath, DRAFT_TTL_MS } from './media-drafts';

describe('local media handoff', () => {
  it('rejects a video disguised by its filename and empty files before storing', () => {
    expect(validateLocalMedia({ type: 'image/jpeg', size: 100, name: 'movie.mp4' }, 'video')).toMatchObject({ ok: false });
    expect(validateLocalMedia({ type: 'image/png', size: 0, name: 'photo.png' }, 'image')).toMatchObject({ ok: false });
  });
  it('preserves the image admission limit and uses server-advertised video limits', () => {
    expect(validateLocalMedia({ type: 'image/png', size: 10 * 1024 * 1024 + 1, name: 'large.png' }, 'image')).toMatchObject({ ok: false });
    expect(validateLocalMedia({ type: 'video/mp4', size: 1001, name: 'clip.mp4' }, 'video', 1000)).toMatchObject({ ok: false });
    expect(validateLocalMedia({ type: 'video/mp4', size: 1000, name: 'clip.mp4' }, 'video', 1000)).toEqual({ ok: true });
  });
  it('uses a one-hour handoff window and routes without putting file data in the URL', () => {
    expect(DRAFT_TTL_MS).toBe(60 * 60 * 1000);
    expect(draftIsExpired({ expiresAt: 200 }, 200)).toBe(true);
    expect(draftIsExpired({ expiresAt: 200 }, 199)).toBe(false);
    expect(workspacePath('image')).toBe('/app/image');
    expect(workspacePath('video')).toBe('/app/video');
  });
});
