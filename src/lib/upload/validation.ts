export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AllowedContentType = keyof typeof extensions;

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'invalid_type' | 'invalid_size'; message: string };

export function validateUploadMetadata(input: { contentType: string; size: number }): ValidationResult {
  if (!(input.contentType in extensions)) {
    return { ok: false, code: 'invalid_type', message: 'Please upload a JPG, PNG, or WEBP image.' };
  }

  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'invalid_size', message: 'The image must be between 1 byte and 10 MB.' };
  }

  return { ok: true };
}

export function createUploadKey(contentType: string, id: string = crypto.randomUUID()): string {
  const extension = extensions[contentType as AllowedContentType];
  if (!extension) throw new Error('Unsupported image type');
  return `uploads/${id}.${extension}`;
}

export function isUploadKey(key: string): boolean {
  return /^uploads\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
}
