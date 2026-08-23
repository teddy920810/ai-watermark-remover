export const DEFAULT_RESPONSIVE_IMAGE_WIDTHS = [480, 768, 1200] as const;

function isOptimizableCmsImage(src: string): boolean {
  return /^\/uploads\/[a-z0-9/_-]+\.(?:jpe?g|png)$/i.test(src) && !src.includes('..');
}

export function optimizedImagePath(src: string, width: number): string | undefined {
  if (!isOptimizableCmsImage(src) || !Number.isSafeInteger(width) || width < 1) return undefined;
  return `/generated${src}-${width}.webp`;
}

export function responsiveImageWidths(src: string, originalWidth: number): number[] {
  if (!isOptimizableCmsImage(src) || !Number.isSafeInteger(originalWidth) || originalWidth < 1) return [];
  const maximumWidth = DEFAULT_RESPONSIVE_IMAGE_WIDTHS.at(-1)!;
  return [...new Set([
    ...DEFAULT_RESPONSIVE_IMAGE_WIDTHS.filter((width) => width < originalWidth),
    Math.min(originalWidth, maximumWidth),
  ])].sort((left, right) => left - right);
}

export function buildOptimizedImageSrcSet(src: string, originalWidth: number): string | undefined {
  const candidates = responsiveImageWidths(src, originalWidth)
    .map((width) => {
      const path = optimizedImagePath(src, width);
      return path ? `${path} ${width}w` : undefined;
    })
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.length > 0 ? candidates.join(', ') : undefined;
}
