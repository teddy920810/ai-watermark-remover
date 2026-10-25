import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { identifyLauncherMedia } from './media-identification';

const imageBytes = (format: 'jpeg' | 'png' | 'webp') => sharp({ create: { width: 2, height: 2, channels: 3, background: '#bcd' } })[format]().toBuffer();
const mp4 = readFileSync(new URL('../../../tests/fixtures/workspace-24fps.mp4', import.meta.url));

describe('automatic launcher file identification', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) it(`identifies ${format} from its bytes, independently of its filename`, async () => {
    const file = new File([new Uint8Array(await imageBytes(format))], 'not-a-video.mp4', { type: `image/${format}` });
    const result = await identifyLauncherMedia(file);
    expect(result).toEqual({ ok: true, kind: 'image', file });
  });

  it('identifies an MP4 container and preserves the original typed File', async () => {
    const file = new File([new Uint8Array(mp4)], 'holiday.mp4', { type: 'video/mp4' });
    expect(await identifyLauncherMedia(file)).toEqual({ ok: true, kind: 'video', file });
  });

  for (const brand of ['iso7', 'iso8', 'iso9', 'dash', 'MSNV']) it(`accepts the ${brand} MP4 brand already supported by the server`, async () => {
    const bytes = new Uint8Array(mp4);
    bytes.set(new TextEncoder().encode(brand), 8);
    const file = new File([bytes], 'recording.mp4', { type: 'video/mp4' });
    expect(await identifyLauncherMedia(file)).toEqual({ ok: true, kind: 'video', file });
  });

  for (const kind of ['image', 'video'] as const) it(`recovers an empty MIME ${kind} without changing its bytes or file metadata`, async () => {
    const bytes = kind === 'image' ? await imageBytes('png') : mp4;
    const file = new File([new Uint8Array(bytes)], 'camera-file', { lastModified: 1234 });
    const result = await identifyLauncherMedia(file);
    expect(result).toMatchObject({ ok: true, kind });
    if (!result.ok) return;
    expect(result.file.type).toBe(kind === 'image' ? 'image/png' : 'video/mp4');
    expect(result.file.name).toBe(file.name);
    expect(result.file.lastModified).toBe(1234);
    expect(await result.file.arrayBuffer()).toEqual(await file.arrayBuffer());
  });

  it('uses file bytes for a generic binary MIME rather than rejecting a legitimate camera file', async () => {
    const result = await identifyLauncherMedia(new File([new Uint8Array(mp4)], 'clip', { type: 'application/octet-stream' }));
    expect(result).toMatchObject({ ok: true, kind: 'video', file: { type: 'video/mp4' } });
  });

  it('rejects a forged MIME even when its filename looks supported', async () => {
    const result = await identifyLauncherMedia(new File([new Uint8Array(mp4)], 'photo.jpg', { type: 'image/jpeg' }));
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/does not match/i) });
  });

  it('rejects unsupported or unreadable contents without guessing from the filename or MIME', async () => {
    for (const file of [
      new File(['not an image'], 'photo.png', { type: 'image/png' }),
      new File(['%PDF-1.7 document'], 'video.mp4', { type: 'video/mp4' }),
      new File(['GIF89a0123456789'], 'photo.gif', { type: 'image/gif' }),
      new File([new Uint8Array([0, 0, 0, 20]), 'ftyp', 'qt  ', new Uint8Array(4), 'qt  '], 'movie.mp4', { type: 'video/mp4' }),
      new File([new Uint8Array([0, 0, 0, 20]), 'ftyp', 'avif', new Uint8Array(4), 'mif1'], 'photo.mp4', { type: 'video/mp4' }),
      new File([new Uint8Array([0, 0, 0, 20]), 'ftyp', 'heic', new Uint8Array(4), 'mif1'], 'camera.mp4', { type: 'video/mp4' }),
    ]) expect(await identifyLauncherMedia(file)).toMatchObject({ ok: false, message: expect.stringMatching(/JPG, PNG, WebP|MP4/i) });
  });

  it('applies the advertised limit for the detected media kind', async () => {
    const image = new File([new Uint8Array(await imageBytes('png'))], 'photo.png', { type: 'image/png' });
    const video = new File([new Uint8Array(mp4)], 'movie.mp4', { type: 'video/mp4' });
    expect(await identifyLauncherMedia(image, { image: image.size - 1, video: video.size })).toMatchObject({ ok: false, message: expect.stringMatching(/image.*limit/i) });
    expect(await identifyLauncherMedia(video, { image: image.size, video: video.size - 1 })).toMatchObject({ ok: false, message: expect.stringMatching(/video.*limit/i) });
    expect(await identifyLauncherMedia(image, { image: image.size })).toMatchObject({ ok: true, kind: 'image' });
    expect(await identifyLauncherMedia(video, { video: video.size })).toMatchObject({ ok: true, kind: 'video' });
  });

  it('rejects empty and over-limit files before reading any contents', async () => {
    const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
    expect(await identifyLauncherMedia(empty)).toMatchObject({ ok: false, message: expect.stringMatching(/empty/i) });
    const oversized = new File([], 'large.mp4', { type: 'video/mp4' });
    Object.defineProperty(oversized, 'size', { value: 100 * 1024 * 1024 + 1 });
    Object.defineProperty(oversized, 'slice', { value: () => { throw new Error('Should not read an oversized file'); } });
    expect(await identifyLauncherMedia(oversized)).toMatchObject({ ok: false, message: expect.stringMatching(/limit/i) });
  });
});
