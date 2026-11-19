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

type MaskTile = { x: number; y: number; pixels: ImageData };
type MaskEdit = { tiles: Map<number, MaskTile>; bytes: number };
const tileSize = 128;
const historyBudget = 64 * 1024 * 1024;

/** Snapshots include each changed tile once per gesture, before its first edit. */
export class MaskUndoHistory {
  private readonly steps: MaskEdit[] = [];
  private pending: MaskEdit | undefined;
  private bytes = 0;

  constructor(private readonly maxSteps: number) {}

  get length() { return this.steps.length; }

  begin() { this.pending = { tiles: new Map(), bytes: 0 }; }

  capture(context: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
    const edit = this.pending;
    if (!edit) return;
    const { width, height } = context.canvas;
    const firstX = Math.max(0, Math.floor(left / tileSize)) * tileSize;
    const firstY = Math.max(0, Math.floor(top / tileSize)) * tileSize;
    for (let y = firstY; y < Math.min(height, bottom); y += tileSize) {
      for (let x = firstX; x < Math.min(width, right); x += tileSize) {
        const key = y * width + x;
        if (edit.tiles.has(key)) continue;
        const pixels = context.getImageData(x, y, Math.min(tileSize, width - x), Math.min(tileSize, height - y));
        edit.tiles.set(key, { x, y, pixels });
        edit.bytes += pixels.data.byteLength;
      }
    }
  }

  finish() {
    const edit = this.pending;
    this.pending = undefined;
    if (!edit?.tiles.size) return;
    this.steps.push(edit);
    this.bytes += edit.bytes;
    // Keep the most recent edit undoable even when one large lasso exceeds the normal budget.
    while (this.steps.length > 1 && (this.steps.length > this.maxSteps || this.bytes > historyBudget)) {
      this.bytes -= this.steps.shift()!.bytes;
    }
  }

  undo(context: CanvasRenderingContext2D) {
    const edit = this.steps.pop();
    if (!edit) return false;
    this.bytes -= edit.bytes;
    for (const { x, y, pixels } of edit.tiles.values()) context.putImageData(pixels, x, y);
    return true;
  }

  clear() {
    this.steps.length = 0;
    this.pending = undefined;
    this.bytes = 0;
  }
}
