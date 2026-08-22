import { createHash, randomUUID } from 'node:crypto';

const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

const contentTypesByExtension = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

function ownerNamespace(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 32);
}

export function createUploadKey(contentType: string, ownerId: string, id: string = randomUUID()): string {
  const extension = extensions[contentType as keyof typeof extensions];
  if (!extension) throw new Error('Unsupported image type');
  return `uploads/users/${ownerNamespace(ownerId)}/${id}.${extension}`;
}

export function isUploadKey(key: string): boolean {
  return /^uploads\/users\/[0-9a-f]{32}\/[a-z0-9-]+\.(?:jpg|png|webp)$/i.test(key);
}

export function isUploadKeyForOwner(key: string, ownerId: string): boolean {
  return isUploadKey(key) && key.startsWith(`uploads/users/${ownerNamespace(ownerId)}/`);
}

export function contentTypeForUploadKey(key: string): string | null {
  const extension = key.match(/\.([a-z]+)$/i)?.[1]?.toLowerCase() as keyof typeof contentTypesByExtension | undefined;
  return extension ? contentTypesByExtension[extension] ?? null : null;
}
