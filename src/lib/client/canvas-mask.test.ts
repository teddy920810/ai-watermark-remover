import { describe, expect, it } from 'vitest';
import { canvasPoint, writeBinaryMask } from './canvas-mask';

describe('small canvas primitives with operation-owned policies', () => {
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
