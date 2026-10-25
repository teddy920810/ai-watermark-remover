import type { MediaKind } from './media-drafts';

export const DEFAULT_LAUNCHER_LIMITS = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 } as const;
export type LauncherLimits = Partial<Record<MediaKind, number>>;
type Identification = { ok: true; kind: MediaKind; file: File } | { ok: false; message: string };

export function launcherLimit(kind: MediaKind, advertised?: number) {
  return advertised !== undefined && Number.isSafeInteger(advertised) && advertised > 0 ? advertised : DEFAULT_LAUNCHER_LIMITS[kind];
}
export function formatLauncherLimit(bytes: number) {
  return bytes < 1024 * 1024 ? `${bytes.toLocaleString('en-US')} bytes` : `${Number((bytes / 1024 / 1024).toFixed(2))} MB`;
}
const text = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
function contentType(bytes: Uint8Array, fileSize: number): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 16 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(text(bytes, 12, 4))) return 'image/webp';
  if (bytes.length < 16 || text(bytes, 4, 4) !== 'ftyp') return null;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > fileSize || boxSize % 4 !== 0) return null;
  // MP4 shares its container with MOV/HEIF/AVIF; an ftyp box alone is insufficient.
  // Keep admission aligned with the existing server probe in src/lib/media/video.ts.
  if (/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V|MSNV)$/.test(text(bytes, 8, 4).trim())) return 'video/mp4';
  return null;
}

/** Local admission only. The workspace still decodes the media and checks it on the server before processing. */
export async function identifyLauncherMedia(file: File, limits: LauncherLimits = {}): Promise<Identification> {
  const imageLimit = launcherLimit('image', limits.image);
  const videoLimit = launcherLimit('video', limits.video);
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, message: 'This file is empty. Choose a JPG, PNG, WebP image or MP4 video.' };
  if (file.size > Math.max(imageLimit, videoLimit)) return { ok: false, message: `This file exceeds the image and video upload limits. Images: ${formatLauncherLimit(imageLimit)}; videos: ${formatLauncherLimit(videoLimit)}.` };
  let detected: string | null;
  try { detected = contentType(new Uint8Array(await file.slice(0, 256).arrayBuffer()), file.size); }
  catch { return { ok: false, message: 'This file could not be read. Choose it again or select another file.' }; }
  if (!detected) return { ok: false, message: 'This file is not a supported JPG, PNG, WebP image or MP4 video. Choose another file.' };
  if (file.type && file.type !== 'application/octet-stream' && file.type !== detected) return { ok: false, message: 'The file type does not match its contents. Choose the original JPG, PNG, WebP image or MP4 video.' };
  const kind: MediaKind = detected === 'video/mp4' ? 'video' : 'image';
  const limit = kind === 'image' ? imageLimit : videoLimit;
  if (file.size > limit) return { ok: false, message: `This ${kind} exceeds the current ${formatLauncherLimit(limit)} upload limit. Choose a smaller ${kind}.` };
  // Some file pickers omit MIME. Preserve bytes, filename and date while making the existing draft/workspace contract usable.
  const normalized = file.type === detected ? file : new File([file], file.name, { type: detected, lastModified: file.lastModified });
  return { ok: true, kind, file: normalized };
}
