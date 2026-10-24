import { describe, expect, it, vi } from 'vitest';
import { parseVideoProbe, probeVideo, validateVideoRequirements } from './video';

const payload = (overrides = {}) => ({
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.5', tags: { major_brand: 'isom' } },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '24/1', r_frame_rate: '24/1', duration: '12.5' },
    { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' },
  ], ...overrides,
});

describe('server ffprobe media inspection', () => {
  it('parses actual codec, dimensions, rational frame rate, duration and audio', () => {
    expect(parseVideoProbe(payload())).toEqual({ mimeType: 'video/mp4', width: 1920, height: 1080, durationSeconds: 12.5, frameRate: 24, videoCodec: 'h264', audio: [{ codec: 'aac', channels: 2, sampleRate: 48000 }] });
  });
  it('uses an explicit cross-platform executable path and argument array without shell interpolation', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify(payload()) });
    await expect(probeVideo('/tmp/user clip; data.mp4', { ffprobePath: '/opt/media/bin/ffprobe', run })).resolves.toMatchObject({ frameRate: 24 });
    expect(run).toHaveBeenCalledWith('/opt/media/bin/ffprobe', expect.arrayContaining(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '/tmp/user clip; data.mp4']), expect.objectContaining({ timeout: 30_000, maxBuffer: 1_048_576, windowsHide: true, shell: false }));
  });
  it('rejects URL inputs and invalid container/probe metadata rather than trusting extensions', async () => {
    const run = vi.fn();
    await expect(probeVideo('https://example.com/a.mp4', { ffprobePath: '/opt/ffprobe', run })).rejects.toThrow('Video input must be a local file path');
    expect(run).not.toHaveBeenCalled();
    expect(() => parseVideoProbe(payload({ format: { format_name: 'mov,mp4', duration: '12', tags: { major_brand: 'qt  ' } } }))).toThrow('Video container must be MP4');
    expect(() => parseVideoProbe({ streams: [], format: {} })).toThrow('Video probe returned invalid metadata');
    expect(() => parseVideoProbe(payload({ streams: [{ codec_type: 'video', width: 10, height: 10, avg_frame_rate: '0/0' }] }))).toThrow('Video probe returned invalid metadata');
  });
  it('checks provider 24fps and duration limits independently without transcoding', () => {
    const video = parseVideoProbe(payload());
    expect(() => validateVideoRequirements(video)).not.toThrow();
    expect(() => validateVideoRequirements({ ...video, frameRate: 29.97 })).toThrow('Video must be 24 fps');
    expect(() => validateVideoRequirements({ ...video, durationSeconds: 540.01 })).toThrow('Video exceeds the duration limit');
    expect(() => validateVideoRequirements(video, { maxWidth: 1280 })).toThrow('Video exceeds the dimension limit');
  });
  it('reports rotation metadata and rejects it before submitting an incorrectly aligned mask', () => {
    const data = payload();
    const video = parseVideoProbe({ ...data, streams: [{ ...data.streams[0], side_data_list: [{ rotation: -90 }] }] });
    expect(video).toMatchObject({ width: 1920, height: 1080, rotationDegrees: -90 });
    expect(() => validateVideoRequirements(video)).toThrow('Video rotation metadata is not supported');
  });
  it('redacts probe process errors and rejects oversized or malformed JSON output', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('sensitive filename and process data'));
    await expect(probeVideo('/tmp/input.mp4', { ffprobePath: '/opt/ffprobe', run: bad })).rejects.toThrow('Unable to inspect video');
    const huge = vi.fn().mockResolvedValue({ stdout: 'x'.repeat(33) });
    await expect(probeVideo('/tmp/input.mp4', { ffprobePath: '/opt/ffprobe', run: huge, maxOutputBytes: 32 })).rejects.toThrow('Video probe output exceeds the limit');
  });
});
