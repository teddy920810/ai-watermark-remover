/** Coordinate and threshold policy belong to the consuming editor. */
export function canvasPoint(bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, width: number, height: number, clientX: number, clientY: number, clamp: boolean) {
  const x = (clientX - bounds.left) / bounds.width * width;
  const y = (clientY - bounds.top) / bounds.height * height;
  return clamp ? { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) } : { x, y };
}

export function writeBinaryMask(source: Uint8ClampedArray, target: Uint8ClampedArray, alphaThreshold: number): boolean {
  let selected = false;
  for (let index = 0; index < target.length; index += 4) {
    const value = source[index + 3] > alphaThreshold ? 255 : 0;
    if (value) selected = true;
    target[index] = value;
    target[index + 1] = value;
    target[index + 2] = value;
    target[index + 3] = 255;
  }
  return selected;
}
