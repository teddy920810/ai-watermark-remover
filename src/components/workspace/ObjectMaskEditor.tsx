import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Brush, Eraser, LassoSelect, RotateCcw, Undo2 } from 'lucide-react';
import { canvasPoint, writeBinaryMask } from '../../lib/client/canvas-mask';
import type { MaskEditorHandle } from './ImageMaskEditor';
import '../../styles/image-editor.css';

type Point = { x: number; y: number };
interface Props { src: string; width: number; height: number; revision: number; disabled: boolean; onSelection(selected: boolean): void; onSelectionStart(): void }

/** Object selection keeps its own clamped coordinates, alpha threshold and twenty-step history. */
export const ObjectMaskEditor = forwardRef<MaskEditorHandle, Props>(function ObjectMaskEditor({ src, width, height, revision, disabled, onSelection, onSelectionStart }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false); const lastPointRef = useRef<Point | null>(null);
  const lassoPointsRef = useRef<Point[]>([]); const historyRef = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<'brush' | 'lasso' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(44); const [hasMask, setHasMask] = useState(false);
  function resetMask() {
    const canvas = canvasRef.current; const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    drawingRef.current = false; lastPointRef.current = null; lassoPointsRef.current = []; historyRef.current = [];
    setHasMask(false); onSelection(false);
  }
  // A signed URL can change for the same source without discarding its current selection.
  useEffect(() => { resetMask(); }, [width, height, revision]);
  useImperativeHandle(ref, () => ({ clear: resetMask, exportMask }));
  function toCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return canvasPoint(rect, canvas.width, canvas.height, event.clientX, event.clientY, true);
  }

  function snapshot() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    historyRef.current = [...historyRef.current.slice(-19), context.getImageData(0, 0, canvas.width, canvas.height)];
  }

  function refreshHasMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return setHasMask(false);
    const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const selected = alpha.some((value, index) => index % 4 === 3 && value > 10);
    setHasMask(selected); onSelection(selected);
  }

  function drawStroke(from: Point, to: Point) {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.save();
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = '#2563eb';
    context.globalAlpha = tool === 'eraser' ? 1 : .44;
    context.lineWidth = brushSize;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    onSelectionStart();
    event.currentTarget.setPointerCapture(event.pointerId);
    snapshot();
    drawingRef.current = true;
    const point = toCanvasPoint(event);
    lastPointRef.current = point;
    lassoPointsRef.current = [point];
    if (tool !== 'lasso') drawStroke(point, point);
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const point = toCanvasPoint(event);
    if (tool === 'lasso') lassoPointsRef.current.push(point);
    else if (lastPointRef.current) drawStroke(lastPointRef.current, point);
    lastPointRef.current = point;
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    if (tool === 'lasso' && lassoPointsRef.current.length > 2) {
      const context = canvasRef.current?.getContext('2d');
      if (context) {
        context.save();
        context.fillStyle = '#2563eb';
        context.globalAlpha = .44;
        context.beginPath();
        context.moveTo(lassoPointsRef.current[0]!.x, lassoPointsRef.current[0]!.y);
        for (const point of lassoPointsRef.current.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
        context.fill();
        context.restore();
      }
    }
    drawingRef.current = false;
    lastPointRef.current = null;
    lassoPointsRef.current = [];
    event.currentTarget.releasePointerCapture(event.pointerId);
    refreshHasMask();
  }

  function undo() {
    if (disabled || !historyRef.current.length) return;
    onSelectionStart();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const previous = historyRef.current.pop();
    if (!canvas || !context || !previous) return;
    context.putImageData(previous, 0, 0);
    refreshHasMask();
  }

  function clearMask() {
    if (disabled) return;
    onSelectionStart();
    snapshot();
    resetMask();
  }

  async function exportMask(): Promise<Blob> {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !hasMask) throw new Error('Brush or lasso over the object you want to remove.');
    const overlay = context.getImageData(0, 0, canvas.width, canvas.height);
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext('2d');
    if (!maskContext) throw new Error('Your browser could not prepare the selection mask.');
    maskContext.fillStyle = '#000000';
    maskContext.fillRect(0, 0, mask.width, mask.height);
    const binary = maskContext.getImageData(0, 0, mask.width, mask.height);
    writeBinaryMask(overlay.data, binary.data, 10);
    maskContext.putImageData(binary, 0, 0);
    maskContext.fillStyle = '#ffffff';
    return new Promise((resolve, reject) => mask.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The mask could not be prepared.')), 'image/png'));
  }


  return <div className="workspace-image-options object-selection">
    <div className="object-editor-stage" style={{ aspectRatio: `${width}/${height}` }}>
      <img src={src} alt="Image to edit" draggable={false} />
      <canvas ref={canvasRef} width={width} height={height} aria-label="Object removal mask canvas" style={{ pointerEvents: disabled ? 'none' : 'auto' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    </div>
    <div className="object-selection-tools" aria-label="Mask tools">
      <div className="object-tool-grid">{(['brush', 'lasso', 'eraser'] as const).map(value => <button key={value} className={tool === value ? 'is-selected' : ''} type="button" aria-pressed={tool === value} disabled={disabled} onClick={() => setTool(value)}>{value === 'brush' ? <Brush size={21} /> : value === 'lasso' ? <LassoSelect size={21} /> : <Eraser size={21} />}<span>{value[0].toUpperCase() + value.slice(1)}</span></button>)}</div>
      <label className="object-brush-size"><span>Brush size</span><input type="range" min="10" max="140" value={brushSize} disabled={disabled} onChange={event => setBrushSize(Number(event.target.value))} /></label>
      <div className="object-history-actions"><button type="button" onClick={undo} disabled={disabled || historyRef.current.length === 0}><Undo2 size={17} />Undo</button><button type="button" onClick={clearMask} disabled={disabled || !hasMask}><RotateCcw size={17} />Clear</button></div>
      <p>Paint or lasso the full object. A small margin helps AI blend the repaired area naturally.</p>
    </div>
  </div>;
});
