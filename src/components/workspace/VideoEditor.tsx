import { forwardRef, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { MaskEditorHandle } from './ImageMaskEditor';
interface Props { src: string; resultSrc?: string; width: number; height: number; duration?: number; fixedArea: boolean; disabled?: boolean; onSelection(hasSelection: boolean): void; onSelectionStart?(): void }
interface Rectangle { x: number; y: number; width: number; height: number }
function time(value: number) { const safe = Number.isFinite(value) ? Math.max(0, value) : 0; return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${Math.floor(safe % 60).toString().padStart(2, '0')}`; }
export const VideoEditor = forwardRef<MaskEditorHandle, Props>(function VideoEditor({ src, resultSrc, width, height, duration, fixedArea, disabled, onSelection, onSelectionStart }, ref) {
  const original = useRef<HTMLVideoElement>(null); const result = useRef<HTMLVideoElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rectangle, setRectangle] = useState<Rectangle | null>(null); const [currentTime, setCurrentTime] = useState(0); const [length, setLength] = useState(duration ?? 0); const [playing, setPlaying] = useState(false); const [error, setError] = useState('');
  function clear() { setRectangle(null); onSelection(false); }
  useImperativeHandle(ref, () => ({ clear, exportMask: async () => {
    if (!rectangle || rectangle.width * width < 2 || rectangle.height * height < 2) throw new Error('Draw a fixed area over the watermark first.');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('The selection could not be prepared.');
    context.fillStyle = '#000000'; context.fillRect(0, 0, width, height); context.fillStyle = '#ffffff'; context.fillRect(Math.floor(rectangle.x * width), Math.floor(rectangle.y * height), Math.ceil(rectangle.width * width), Math.ceil(rectangle.height * height));
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The selection could not be prepared.')), 'image/png'));
  } }));
  function position(event: PointerEvent<HTMLDivElement>) { const box = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }; }
  function seek(value: number) { if (original.current) original.current.currentTime = value; if (result.current) result.current.currentTime = value; setCurrentTime(value); }
  async function togglePlay() { if (!original.current) return; if (playing) { original.current.pause(); result.current?.pause(); setPlaying(false); } else { try { if (result.current) { result.current.currentTime = original.current.currentTime; await result.current.play(); } await original.current.play(); setPlaying(true); } catch { result.current?.pause(); setPlaying(false); setError('Playback could not start. Refresh the preview link and try again.'); } } }
  return <div className="workspace-video-editor">
    <div className={resultSrc ? 'workspace-video-comparison' : ''}>
      <figure><figcaption>{resultSrc ? 'Original' : 'Video preview'}</figcaption><div className={`workspace-video-stage ${fixedArea ? 'is-selecting' : ''}`} style={{ aspectRatio: `${width || 16}/${height || 9}` }} onPointerDown={event => { if (!fixedArea || disabled) return; onSelectionStart?.(); original.current?.pause(); setPlaying(false); start.current = position(event); event.currentTarget.setPointerCapture(event.pointerId); setRectangle(null); onSelection(false); }} onPointerMove={event => { if (!start.current || disabled) return; const point = position(event); setRectangle({ x: Math.min(point.x, start.current.x), y: Math.min(point.y, start.current.y), width: Math.abs(point.x - start.current.x), height: Math.abs(point.y - start.current.y) }); }} onPointerUp={event => { if (!start.current) return; start.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); onSelection(!!rectangle && rectangle.width * width >= 2 && rectangle.height * height >= 2); }} onPointerCancel={() => { start.current = null; clear(); }}>
        <video key={src} ref={original} src={src} preload="metadata" playsInline onLoadedMetadata={event => setLength(event.currentTarget.duration)} onError={() => setError('The original video could not load. Refresh the preview or choose the MP4 again.')} onTimeUpdate={event => { const value = event.currentTarget.currentTime; setCurrentTime(value); if (result.current && Math.abs(result.current.currentTime - value) > .15) result.current.currentTime = value; }} onEnded={() => { setPlaying(false); result.current?.pause(); }} />
        {fixedArea && rectangle && <div className="video-fixed-selection" aria-label="Fixed watermark area" style={{ left: `${rectangle.x * 100}%`, top: `${rectangle.y * 100}%`, width: `${rectangle.width * 100}%`, height: `${rectangle.height * 100}%` }}><span>Fixed area · entire video</span></div>}
      </div></figure>
      {resultSrc && <figure><figcaption>Result</figcaption><div className="workspace-video-stage" style={{ aspectRatio: `${width || 16}/${height || 9}` }}><video key={resultSrc} ref={result} src={resultSrc} muted playsInline preload="metadata" onError={() => setError('The result video could not load. Refresh its link or download the MP4.')} /></div></figure>}
    </div>
    <div className="workspace-playback"><button type="button" onClick={() => void togglePlay()} aria-label={playing ? 'Pause videos' : 'Play videos'}>{playing ? <Pause size={20} /> : <Play size={20} />}</button><input type="range" aria-label="Video playback position" min={0} max={Number.isFinite(length) ? length : 0} step="0.05" value={currentTime} onChange={event => seek(Number(event.target.value))} /><span>{time(currentTime)} / {time(length)}</span></div>
    {fixedArea && <p className="workspace-selection-help">Draw over a watermark that stays in one place. Scrub to check the area.<button type="button" onClick={clear} disabled={disabled}><RotateCcw size={15} />Clear area</button></p>}
    {resultSrc && <p className="workspace-media-caption">Both videos share playback and position. Audio plays from the original.</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>;
});
