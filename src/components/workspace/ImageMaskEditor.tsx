import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
export interface MaskEditorHandle { exportMask(): Promise<Blob>; clear(): void }
interface Props { src: string; width: number; height: number; editable: boolean; disabled?: boolean; tool: 'brush' | 'eraser'; brushSize: number; showSelection: boolean; onSelection(hasSelection: boolean): void; onSelectionStart?(): void; undoToken: number }
export const ImageMaskEditor = forwardRef<MaskEditorHandle, Props>(function ImageMaskEditor({ src, width, height, editable, disabled, tool, brushSize, showSelection, onSelection, onSelectionStart, undoToken }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const history = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [imageError, setImageError] = useState(false);
  function changed() { const context = canvas.current?.getContext('2d'); if (!context || !canvas.current) return; const data = context.getImageData(0, 0, canvas.current.width, canvas.current.height).data; onSelection(data.some((value, index) => index % 4 === 3 && value > 0)); }
  function clear() { const context = canvas.current?.getContext('2d'); if (context && canvas.current) context.clearRect(0, 0, canvas.current.width, canvas.current.height); history.current = []; onSelection(false); }
  useEffect(() => { clear(); setImageError(false); /* New media must never inherit a previous selection. */ }, [src, width, height]);
  useEffect(() => { if (undoToken === 0) return; const previous = history.current.pop(); const context = canvas.current?.getContext('2d'); if (previous && context) context.putImageData(previous, 0, 0); changed(); }, [undoToken]);
  useImperativeHandle(ref, () => ({ clear, exportMask: async () => {
    const source = canvas.current; if (!source) throw new Error('Select the remaining watermark first.');
    const output = document.createElement('canvas'); output.width = source.width; output.height = source.height;
    const context = output.getContext('2d'); const sourceContext = source.getContext('2d'); if (!context || !sourceContext) throw new Error('Your browser could not prepare the selection.');
    const selection = sourceContext.getImageData(0, 0, source.width, source.height);
    const binary = context.createImageData(source.width, source.height); let selected = false;
    for (let i = 0; i < binary.data.length; i += 4) { const value = selection.data[i + 3] > 0 ? 255 : 0; if (value) selected = true; binary.data[i] = value; binary.data[i + 1] = value; binary.data[i + 2] = value; binary.data[i + 3] = 255; }
    if (!selected) throw new Error('Paint over the watermark you want to remove.');
    context.putImageData(binary, 0, 0);
    return new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('The selection could not be prepared.')), 'image/png'));
  } }));
  function point(event: PointerEvent<HTMLCanvasElement>) { const box = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - box.left) / box.width * width, y: (event.clientY - box.top) / box.height * height }; }
  function paint(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return; const context = event.currentTarget.getContext('2d'); if (!context) return;
    const current = point(event); const previous = last.current ?? current;
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; context.strokeStyle = 'rgba(50,106,232,0.45)'; context.fillStyle = context.strokeStyle; context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = brushSize;
    context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(current.x, current.y); context.stroke(); context.beginPath(); context.arc(current.x, current.y, brushSize / 2, 0, Math.PI * 2); context.fill(); last.current = current;
  }
  return <div className="workspace-image-stage" style={{ aspectRatio: `${width || 4}/${height || 3}` }}>
    <img src={src} alt={editable ? 'Image to refine. Paint over the remaining watermark.' : 'Selected image preview'} draggable={false} onError={() => setImageError(true)} />
    {imageError && <p role="alert" className="workspace-media-error">The preview could not load. Refresh the result link or try downloading.</p>}
    {editable && <canvas ref={canvas} width={width || 1} height={height || 1} aria-label="Watermark refinement selection" style={{ pointerEvents: disabled ? 'none' : 'auto', opacity: showSelection ? 1 : 0 }} onPointerDown={event => {
      if (disabled) return; event.preventDefault(); const context = event.currentTarget.getContext('2d'); if (!context) return; onSelectionStart?.();
      history.current.push(context.getImageData(0, 0, event.currentTarget.width, event.currentTarget.height)); if (history.current.length > 8) history.current.shift(); drawing.current = true; last.current = null; event.currentTarget.setPointerCapture(event.pointerId); paint(event);
    }} onPointerMove={paint} onPointerUp={event => { drawing.current = false; last.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); changed(); }} onPointerCancel={() => { drawing.current = false; last.current = null; changed(); }} />}
  </div>;
});
