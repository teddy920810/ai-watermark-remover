import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

export interface VideoInfo {
  mimeType: 'video/mp4';
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  videoCodec: string;
  rotationDegrees?: number;
  audio: { codec: string; channels?: number; sampleRate?: number }[];
}
interface ProbeRunOptions { timeout: number; maxBuffer: number; windowsHide: boolean; shell: false }
export type ProbeRunner = (file: string, args: string[], options: ProbeRunOptions) => Promise<{ stdout: string }>;
const defaultRun: ProbeRunner = promisify(execFile);
const numeric = z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite().positive());
const streamSchema = z.object({
  codec_type: z.string(), codec_name: z.string().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  avg_frame_rate: z.string().optional(), r_frame_rate: z.string().optional(), duration: numeric.optional(),
  channels: z.number().int().positive().optional(), sample_rate: numeric.optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).optional(),
  tags: z.object({ rotate: z.union([z.string(), z.number()]).optional() }).optional(),
  side_data_list: z.array(z.object({ rotation: z.number().finite().optional() })).optional(),
});
const probeSchema = z.object({
  format: z.object({ format_name: z.string(), duration: numeric.optional(), tags: z.record(z.string(), z.unknown()).optional() }),
  streams: z.array(streamSchema),
});

function rational(value?: string): number {
  if (!value) return NaN;
  const parts = value.split('/');
  if (parts.length > 2) return NaN;
  const denominator = parts.length === 2 ? Number(parts[1]) : 1;
  return denominator > 0 ? Number(parts[0]) / denominator : NaN;
}

export function parseVideoProbe(payload: unknown): VideoInfo {
  const parsed = probeSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Video probe returned invalid metadata');
  const { format, streams } = parsed.data;
  const video = streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const durationSeconds = format.duration ?? video?.duration;
  const frameRate = rational(video?.avg_frame_rate ?? video?.r_frame_rate);
  if (!video?.width || !video.height || !video.codec_name || !durationSeconds || !Number.isFinite(frameRate) || frameRate <= 0) throw new Error('Video probe returned invalid metadata');
  // ffprobe reports MOV and MP4 under the same demuxer: inspect the actual brand.
  const brand = String(format.tags?.major_brand ?? '').trim();
  if (!format.format_name.split(',').includes('mp4') || !/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V|MSNV)$/.test(brand)) throw new Error('Video container must be MP4');
  const rotationDegrees = video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0);
  if (!Number.isFinite(rotationDegrees)) throw new Error('Video probe returned invalid metadata');
  return {
    mimeType: 'video/mp4', width: video.width, height: video.height, durationSeconds, frameRate, videoCodec: video.codec_name,
    ...(rotationDegrees % 360 !== 0 ? { rotationDegrees } : {}),
    audio: streams.filter((stream) => stream.codec_type === 'audio').map((stream) => ({ codec: stream.codec_name ?? 'unknown', ...(stream.channels ? { channels: stream.channels } : {}), ...(stream.sample_rate ? { sampleRate: stream.sample_rate } : {}) })),
  };
}

export async function probeVideo(inputPath: string, options: { ffprobePath: string; timeoutMs?: number; maxOutputBytes?: number; run?: ProbeRunner }): Promise<VideoInfo> {
  if (!inputPath || inputPath.includes('\0') || (!path.isAbsolute(inputPath) && !path.win32.isAbsolute(inputPath)) || /^[a-z]+:\/\//i.test(inputPath)) throw new Error('Video input must be a local file path');
  if (!options.ffprobePath || options.ffprobePath.includes('\0')) throw new Error('An ffprobe executable path is required');
  const timeout = options.timeoutMs ?? 30_000;
  const maxBuffer = options.maxOutputBytes ?? 1_048_576;
  if (![timeout, maxBuffer].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Video probe limits are invalid');
  let stdout: string;
  try {
    ({ stdout } = await (options.run ?? defaultRun)(options.ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', inputPath], { timeout, maxBuffer, windowsHide: true, shell: false }));
  } catch {
    throw new Error('Unable to inspect video');
  }
  if (Buffer.byteLength(stdout) > maxBuffer) throw new Error('Video probe output exceeds the limit');
  let payload: unknown;
  try { payload = JSON.parse(stdout); } catch { throw new Error('Video probe returned invalid metadata'); }
  return parseVideoProbe(payload);
}

export function validateVideoRequirements(info: VideoInfo, options: { maxDurationSeconds?: number; requiredFrameRate?: number; maxWidth?: number; maxHeight?: number } = {}): void {
  // Site compatibility boundary until provider rotation/mask semantics are verified.
  if (info.rotationDegrees) throw new Error('Video rotation metadata is not supported');
  const requiredFrameRate = options.requiredFrameRate ?? 24;
  if (!Number.isFinite(info.frameRate) || Math.abs(info.frameRate - requiredFrameRate) > 0.001) throw new Error(`Video must be ${requiredFrameRate} fps`);
  if (!Number.isFinite(info.durationSeconds) || info.durationSeconds <= 0 || info.durationSeconds > (options.maxDurationSeconds ?? 540)) throw new Error('Video exceeds the duration limit');
  if ((options.maxWidth && info.width > options.maxWidth) || (options.maxHeight && info.height > options.maxHeight)) throw new Error('Video exceeds the dimension limit');
}
