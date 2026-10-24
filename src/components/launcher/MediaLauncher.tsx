import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, CloudUpload, Image as ImageIcon, Info, Video } from 'lucide-react';
import { cleanExpiredMediaDrafts, saveMediaDraft, validateLocalMedia, workspacePath, type MediaKind } from '../../lib/client/media-drafts';
import type { Capability } from '../workspace/workspace-api';
import type { UploaderCopy } from '../../lib/content/site-settings';
import { LauncherPrompt, launcherCopy } from './launcher-copy';
import './launcher.css';

interface Props { kind?: MediaKind; source?: string; copy?: UploaderCopy }
export default function MediaLauncher({ kind = 'image', source = 'landing', copy }: Props) {
  const labels = launcherCopy(kind, copy);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [capability, setCapability] = useState<Capability | null>(null);
  useEffect(() => {
    setHydrated(true);
    void cleanExpiredMediaDrafts().catch(() => {});
    const controller = new AbortController();
    void fetch('/api/v1/capabilities', { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const body = await response.json() as { operations: Capability[] };
      setCapability(body.operations.find(value => value.operation === (kind === 'video' ? 'video-watermark' : 'image-watermark')) ?? null);
    }).catch(() => {});
    return () => controller.abort();
  }, [kind]);
  async function select(file?: File) {
    if (!file || pending) return;
    const validation = validateLocalMedia(file, kind, capability?.maxBytes);
    if (!validation.ok) { setError(validation.message); return; }
    setPending(true); setError('');
    try { await saveMediaDraft(file, kind, source); window.location.assign(workspacePath(kind)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'This file could not be saved. Choose it directly in the workspace.'); setPending(false); }
  }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void select(event.dataTransfer.files[0]); }
  return <div className="media-launcher" data-media-launcher={kind}>
    <nav className="launcher-modes" aria-label="Watermark media type">
      <a href="/#tool" aria-current={kind === 'image' ? 'page' : undefined}><ImageIcon size={18} />Image</a>
      <a href="/video-watermark-remover#tool" aria-current={kind === 'video' ? 'page' : undefined}><Video size={18} />Video</a>
    </nav>
    <div className={`launcher-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <CloudUpload className="launcher-upload-icon" size={38} strokeWidth={1.7} aria-hidden="true" />
      <button className="button button-primary" type="button" onClick={() => input.current?.click()} disabled={pending || !hydrated}><CloudUpload size={22} />{!hydrated ? 'Preparing upload…' : pending ? 'Keeping your draft…' : `Upload ${kind}`}</button>
      <LauncherPrompt kind={kind} copy={copy} />
      <div className="launcher-requirements">{kind === 'video' ? <>MP4 · 24 fps · up to 9 min{capability ? ` · ${Math.round(capability.maxBytes / 1024 / 1024)} MB` : ''}</> : <>JPG, PNG or WebP · up to 10 MB<br />Output: JPG</>}</div>
      <small><Info size={15} />Review the cost before processing.</small>
      <input ref={input} className="sr-only" data-testid="media-launcher-file" type="file" disabled={!hydrated || pending} aria-label={labels.fileInputLabel} accept={kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'} onChange={event => { void select(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {capability && !capability.enabled && <p className="launcher-service-note">{capability.reason ?? 'Processing is temporarily unavailable. You can still prepare your file in the workspace.'}</p>}
    {error && <div className="launcher-error" role="alert"><p>{error}</p><a href={workspacePath(kind)}>Open {kind} workspace <ArrowRight size={15} /></a></div>}
    <p className="launcher-local-note">Your file stays on this device until you sign in and upload.</p>
    <a className="launcher-workspace-link" href={workspacePath(kind)}>Open workspace <ArrowRight size={15} /></a>
  </div>;
}
