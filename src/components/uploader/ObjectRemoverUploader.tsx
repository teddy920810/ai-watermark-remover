import {
  Brush, Columns2, CloudUpload, Download, Eraser, LassoSelect, LockKeyhole,
  RotateCcw, Trash2, Undo2,
} from 'lucide-react';
import {
  useCallback, useEffect, useReducer, useRef, useState,
  type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { authClient } from '../auth/auth-client';
import type { UploaderCopy } from '../../lib/content/site-settings';
import { putFileWithRetry } from '../../lib/upload/direct-upload';
import { MAX_UPLOAD_BYTES, validateUploadMetadata } from '../../lib/upload/validation';
import { initialUploadState, uploadReducer } from './upload-machine';

type JsonRecord = Record<string, unknown>;
type Tool = 'brush' | 'lasso' | 'eraser';
type CompletedJobLinks = { status: string; resultUrl?: string; downloadUrl?: string; error?: string };
type Point = { x: number; y: number };

interface Props { logo: string; siteName: string; copy: UploaderCopy }

async function api<T extends JsonRecord>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
  return body;
}

function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function formatCopy(template: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
}
function userFacingError(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') return fallback;
  return error instanceof Error ? error.message : fallback;
}

export default function ObjectRemoverUploader({ logo, siteName, copy }: Props) {
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(44);
  const [imageAspectRatio, setImageAspectRatio] = useState(16 / 9);
  const [hasMask, setHasMask] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef<HTMLElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const historyRef = useRef<ImageData[]>([]);

  const expanded = Boolean(state.previewUrl);
  const busy = state.phase === 'uploading' || state.phase === 'processing';

  useEffect(() => {
    const hero = toolRef.current?.closest('.hero-inner');
    if (!hero) return;
    hero.classList.toggle('is-tool-expanded', expanded);
    return () => hero.classList.remove('is-tool-expanded');
  }, [expanded]);

  useEffect(() => () => {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  }, [state.previewUrl]);

  const resetMask = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    historyRef.current = [];
    setHasMask(false);
  }, []);

  const selectFile = useCallback((nextFile: File) => {
    const result = validateUploadMetadata({ contentType: nextFile.type, size: nextFile.size });
    if (!result.ok) {
      dispatch({ type: 'error', message: result.message });
      return;
    }
    setFile(nextFile);
    setShowOriginal(false);
    setResultError(null);
    historyRef.current = [];
    setHasMask(false);
    dispatch({ type: 'select', previewUrl: URL.createObjectURL(nextFile), fileName: nextFile.name });
  }, []);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      const image = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (image) { event.preventDefault(); selectFile(image); }
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [selectFile]);

  function onImageLoad() {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    setImageAspectRatio(image.naturalWidth / image.naturalHeight);
    resetMask();
  }

  function toCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
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
    setHasMask(alpha.some((value, index) => index % 4 === 3 && value > 10));
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
    if (busy || state.phase === 'completed') return;
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
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const previous = historyRef.current.pop();
    if (!canvas || !context || !previous) return;
    context.putImageData(previous, 0, 0);
    refreshHasMask();
  }

  function clearMask() {
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
    for (let index = 0; index < overlay.data.length; index += 4) {
      if (overlay.data[index + 3]! > 10) {
        binary.data[index] = 255;
        binary.data[index + 1] = 255;
        binary.data[index + 2] = 255;
      }
    }
    maskContext.putImageData(binary, 0, 0);
    maskContext.fillStyle = '#ffffff';
    return new Promise((resolve, reject) => mask.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The mask could not be prepared.')), 'image/png'));
  }

  const uploadAndProcess = useCallback(async () => {
    if (!file) return;
    try {
      const maskBlob = await exportMask();
      dispatch({ type: 'upload' });
      const [sourceSigned, maskSigned] = await Promise.all([
        api<{ url: string; key: string }>('/api/upload-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, size: file.size }),
        }),
        api<{ url: string; key: string }>('/api/upload-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: 'image/png', size: maskBlob.size }),
        }),
      ]);
      const [sourceUpload, maskUpload] = await Promise.all([
        putFileWithRetry(sourceSigned.url, file, file.type),
        putFileWithRetry(maskSigned.url, maskBlob, 'image/png'),
      ]);
      if (!sourceUpload.ok || !maskUpload.ok) throw new Error('The image and mask could not be uploaded. Please try again.');
      const created = await api<{ id: string; status: string }>('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputKey: sourceSigned.key, maskKey: maskSigned.key, operation: 'object-removal' }),
      });
      window.dispatchEvent(new Event('benefits:changed'));
      dispatch({ type: 'process', jobId: created.id });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const job = await api<CompletedJobLinks>(`/api/jobs/${created.id}`);
        if (job.status === 'completed' && job.resultUrl && job.downloadUrl) {
          setShowOriginal(false);
          dispatch({ type: 'complete', resultUrl: job.resultUrl, downloadUrl: job.downloadUrl });
          return;
        }
        if (job.status === 'failed') throw new Error(job.error ?? 'Object removal failed.');
        await wait(1000);
      }
      throw new Error('Processing took too long. Please try again.');
    } catch (error) {
      window.dispatchEvent(new Event('benefits:changed'));
      dispatch({ type: 'error', message: userFacingError(error, 'The image service could not be reached. Please check your connection and try again.') });
    }
  }, [file, hasMask]);

  function start() {
    if (!file || !hasMask || sessionPending || busy) return;
    if (!session?.user) return setShowLogin(true);
    void uploadAndProcess();
  }

  useEffect(() => {
    let completing = false;
    async function completeAuth(data: unknown) {
      if (completing || (data as { type?: string } | null)?.type !== 'clearmark-auth-complete') return;
      completing = true;
      const refreshed = await authClient.getSession();
      if (!refreshed.data?.user) {
        completing = false; setLoginPending(false);
        dispatch({ type: 'error', message: 'Google sign-in could not be confirmed. Please try again.' });
        return;
      }
      await refetchSession(); setShowLogin(false); setLoginPending(false); await uploadAndProcess();
    }
    function handleWindowMessage(event: MessageEvent) {
      if (event.origin === window.location.origin) void completeAuth(event.data);
    }
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clearmark-auth');
    channel?.addEventListener('message', (event) => void completeAuth(event.data));
    window.addEventListener('message', handleWindowMessage);
    return () => { channel?.close(); window.removeEventListener('message', handleWindowMessage); };
  }, [refetchSession, uploadAndProcess]);

  async function continueWithGoogle() {
    const popup = window.open('about:blank', 'clearmark-google-auth', 'popup=yes,width=520,height=680,left=240,top=80');
    if (!popup) { setShowLogin(false); dispatch({ type: 'error', message: 'Please allow popups, then try again.' }); return; }
    setLoginPending(true);
    const result = await authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}/auth/popup`, disableRedirect: true });
    if (result.error || !result.data?.url) {
      popup.close(); setLoginPending(false); dispatch({ type: 'error', message: 'Unable to start Google sign-in. Please try again.' }); return;
    }
    popup.location.href = result.data.url;
  }

  function reset() {
    setFile(null); setShowOriginal(false); setResultError(null); resetMask();
    if (inputRef.current) inputRef.current.value = '';
    dispatch({ type: 'reset' });
  }

  async function downloadResult() {
    if (!state.jobId) return;
    try {
      setDownloadPending(true);
      const job = await api<CompletedJobLinks>(`/api/jobs/${state.jobId}`);
      if (job.status !== 'completed' || !job.downloadUrl) throw new Error(job.error ?? 'The result is not available yet.');
      const anchor = document.createElement('a');
      anchor.href = job.downloadUrl; anchor.download = 'object-removed-image.png'; anchor.click();
    } catch (error) {
      setResultError(userFacingError(error, 'The result could not be downloaded. Please check your connection and try again.'));
    } finally { setDownloadPending(false); }
  }

  return (
    <section ref={toolRef} className="tool-card object-tool-card" aria-labelledby="object-upload-title">
      <div className="tool-heading">
        <div><span className="eyebrow">AI OBJECT REMOVER</span><h2 id="object-upload-title">{expanded ? 'Paint over anything you want to remove' : copy.hero.heading}</h2></div>
        <span className="demo-badge" title={copy.hero.demoBadgeTitle}>{copy.hero.demoBadge}</span>
      </div>

      {!state.previewUrl ? (
        <label className={`drop-zone object-drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault(); setDragging(false); const nextFile = event.dataTransfer.files?.[0]; if (nextFile) selectFile(nextFile);
          }}>
          <span className="upload-action"><CloudUpload size={20} /><strong>{copy.dropzone.dropLabel}</strong></span>
          <span>{copy.dropzone.browseLabel} or paste an image (Ctrl+V)</span>
          <small>{copy.dropzone.formatLabel} · {formatCopy(copy.dropzone.maxSizeLabel, { maxSize: String(MAX_UPLOAD_BYTES / 1024 / 1024) })}</small>
          <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,.jfif" aria-label={copy.dropzone.fileInputLabel}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { const nextFile = event.target.files?.[0]; if (nextFile) selectFile(nextFile); }} />
        </label>
      ) : null}

      {state.message ? <p className="error-message" role="alert">{state.message}</p> : null}

      {state.previewUrl ? (
        <div className="object-workspace">
          <div className="object-editor-stage" style={{ aspectRatio: imageAspectRatio, width: `min(100%, calc(66vh * ${imageAspectRatio}))` }}>
            <img ref={imageRef} src={(showOriginal || state.phase !== 'completed' ? state.previewUrl : state.resultUrl) ?? undefined} alt={state.phase === 'completed' ? copy.result.resultAlt : formatCopy(copy.preview.altTemplate, { fileName: state.fileName ?? '' })} onLoad={state.phase === 'completed' ? undefined : onImageLoad} />
            {state.phase !== 'completed' ? <canvas ref={canvasRef} aria-label="Object removal mask canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /> : null}
            <button className="object-reset" type="button" onClick={reset} aria-label="Remove image and start over"><Trash2 size={18} /></button>
            {state.phase === 'completed' ? <button className="object-compare" type="button" onClick={() => setShowOriginal((value) => !value)}><Columns2 size={18} />{showOriginal ? 'Result' : 'Before'}</button> : null}
          </div>

          {state.phase !== 'completed' ? (
            <aside className="object-controls" aria-label="Mask tools">
              <div className="object-tool-grid">
                <button className={tool === 'brush' ? 'is-selected' : ''} type="button" onClick={() => setTool('brush')}><Brush size={21} /><span>Brush</span></button>
                <button className={tool === 'lasso' ? 'is-selected' : ''} type="button" onClick={() => setTool('lasso')}><LassoSelect size={21} /><span>Lasso</span></button>
                <button className={tool === 'eraser' ? 'is-selected' : ''} type="button" onClick={() => setTool('eraser')}><Eraser size={21} /><span>Eraser</span></button>
              </div>
              <label className="object-brush-size"><span>Brush size</span><input type="range" min="10" max="140" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
              <div className="object-history-actions">
                <button type="button" onClick={undo} disabled={historyRef.current.length === 0}><Undo2 size={17} />Undo</button>
                <button type="button" onClick={clearMask} disabled={!hasMask}><RotateCcw size={17} />Clear</button>
              </div>
              <p>Paint or lasso the full object. A small margin helps AI blend the repaired area naturally.</p>
              <button className="button button-primary object-remove-button" type="button" onClick={start} disabled={!hasMask || busy || sessionPending}>
                {state.phase === 'uploading' ? 'Uploading image and mask…' : state.phase === 'processing' ? 'Removing object…' : 'Remove object'}
              </button>
            </aside>
          ) : (
            <aside className="object-controls object-result-controls">
              <span className="object-result-mark">✓</span><h3>Object removed</h3><p>Your result is ready as a full-resolution PNG.</p>
              <button className="button button-primary" type="button" onClick={downloadResult} disabled={downloadPending}><Download size={17} />{downloadPending ? 'Preparing…' : 'Download PNG'}</button>
              <button className="button button-ghost" type="button" onClick={reset}>Process another</button>
            </aside>
          )}
        </div>
      ) : null}

      {resultError ? <p className="error-message" role="alert">{resultError}</p> : null}
      {busy ? <div className="progress-track" aria-label="Processing"><span /></div> : null}

      {showLogin ? <div className="auth-modal-backdrop"><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="object-auth-title">
        <button className="auth-modal-close" type="button" onClick={() => setShowLogin(false)} aria-label={copy.auth.closeLabel}>×</button>
        <img className="brand-logo auth-logo" src={logo} alt={`${siteName} logo`} /><h3 id="object-auth-title">{copy.auth.title}</h3><p>{copy.auth.description}</p>
        <button className="button button-primary auth-google-button" type="button" onClick={continueWithGoogle} disabled={loginPending}><span className="google-mark">G</span>{loginPending ? copy.auth.connectingButton : copy.auth.continueButton}</button>
        <button className="button button-ghost" type="button" onClick={() => setShowLogin(false)}>{copy.auth.dismissButton}</button>
      </section></div> : null}

      <p className="privacy-note"><LockKeyhole size={14} /> {copy.privacyNote}</p>
    </section>
  );
}
