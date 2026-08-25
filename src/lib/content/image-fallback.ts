import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { IMAGE_PLACEHOLDER_DIMENSIONS, IMAGE_PLACEHOLDER_SRC } from './image-fallback-constants';

export { IMAGE_PLACEHOLDER_DIMENSIONS, IMAGE_PLACEHOLDER_SRC };

type Exists = (path: string) => boolean;

export function resolvePublicImageSource(
  src: string,
  exists: Exists = existsSync,
  publicDirectory = resolve(process.cwd(), 'public'),
): string {
  if (!/^\/uploads\/[a-z0-9][a-z0-9._/-]*$/i.test(src) || src.includes('..')) return src;
  return exists(resolve(publicDirectory, src.slice(1))) ? src : IMAGE_PLACEHOLDER_SRC;
}
