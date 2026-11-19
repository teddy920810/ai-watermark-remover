import { describe, expect, it } from 'vitest';
import { canvasPoint, MaskUndoHistory, writeBinaryMask } from './canvas-mask';

describe('small canvas primitives with operation-owned policies', () => {
  it('keeps 20 small strokes on a 4000 × 3000 canvas without twenty full-frame snapshots', () => {
    const restored: [number, number][] = [];
    let bytes = 0;
    const context = {
      canvas: { width: 4000, height: 3000 },
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4);
        bytes += data.byteLength;
        return { width, height, data };
      },
      putImageData: (_image: ImageData, x: number, y: number) => restored.push([x, y]),
    } as unknown as CanvasRenderingContext2D;
    const history = new MaskUndoHistory(20);
    for (let step = 0; step < 20; step++) {
      history.begin();
      history.capture(context, 10, 10, 80, 80);
      history.capture(context, 12, 12, 82, 82);
      history.finish();
    }
    expect(history.length).toBe(20);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    expect(history.undo(context)).toBe(true);
    expect(restored).toEqual([[0, 0]]);
  });
  it('maps coordinates at scaled sizes while preserving object clamp and refinement pointer policies', () => {
    const bounds={left:10,top:20,width:100,height:50};
    expect(canvasPoint(bounds,1000,500,60,45,true)).toEqual({x:500,y:250});
    expect(canvasPoint(bounds,1000,500,-10,90,true)).toEqual({x:0,y:500});
    expect(canvasPoint(bounds,1000,500,-10,90,false)).toEqual({x:-200,y:700});
  });
  it('exports fully opaque binary pixels and retains the two different alpha thresholds', () => {
    const source=new Uint8ClampedArray([20,30,40,0,20,30,40,1,20,30,40,10,20,30,40,11]);
    const object=new Uint8ClampedArray(16);const refine=new Uint8ClampedArray(16);
    expect(writeBinaryMask(source,object,10)).toBe(true);expect(writeBinaryMask(source,refine,0)).toBe(true);
    expect([...object]).toEqual([0,0,0,255,0,0,0,255,0,0,0,255,255,255,255,255]);
    expect([...refine]).toEqual([0,0,0,255,255,255,255,255,255,255,255,255,255,255,255,255]);
    expect([...source]).toEqual([20,30,40,0,20,30,40,1,20,30,40,10,20,30,40,11]);
    expect(writeBinaryMask(new Uint8ClampedArray(4),new Uint8ClampedArray(4),0)).toBe(false);
  });
});
