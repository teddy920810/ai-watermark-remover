import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, CloudUpload, Image as ImageIcon, Info, Video } from 'lucide-react';
import { cleanExpiredMediaDrafts, saveMediaDraft, validateLocalMedia, workspacePath, type MediaKind } from '../../lib/client/media-drafts';
import { formatLauncherLimit, identifyLauncherMedia, launcherLimit } from '../../lib/client/media-identification';
import type { Capability } from '../workspace/workspace-api';
import type { UploaderCopy } from '../../lib/content/site-settings';
import { LauncherPrompt, launcherCopy } from './launcher-copy';
import './launcher.css';

interface Props { kind?: MediaKind; source?: string; copy?: UploaderCopy; autoDetect?: boolean }
export default function MediaLauncher({ kind = 'image', source = 'landing', copy, autoDetect = false }: Props) {
  const labels = autoDetect ? {
    dropLabel: copy?.dropzone.dropLabel ?? 'Drop an image or MP4 video here',
    browseLabel: copy?.dropzone.browseLabel ?? 'or click to browse',
    fileInputLabel: copy?.dropzone.fileInputLabel ?? 'Choose an image or MP4 video',
  } : launcherCopy(kind, copy);
  const input = useRef<HTMLInputElement>(null);
  const selecting = useRef(false);
  const capabilityRequest = useRef<Promise<Capability[]> | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [capabilityError, setCapabilityError] = useState(false);
  const [selectedKind, setSelectedKind] = useState(kind);
  const capabilityFor = (values: Capability[], media: MediaKind) => values.find(value => value.operation === (media === 'video' ? 'video-watermark' : 'image-watermark'));
  const capability = capabilityFor(capabilities, kind);
  const imageLimit = launcherLimit('image', capabilityFor(capabilities, 'image')?.maxBytes);
  const videoCapability = capabilityFor(capabilities, 'video');
  const videoLimit = launcherLimit('video', videoCapability?.maxBytes);
  useEffect(() => {
    setHydrated(true);
    void cleanExpiredMediaDrafts().catch(() => {});
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    capabilityRequest.current = fetch('/api/v1/capabilities', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Capabilities unavailable');
      const body = await response.json() as { operations: Capability[] };
      if (!Array.isArray(body.operations)) throw new Error('Capabilities unavailable');
      const values = body.operations.filter(value => value && typeof value.operation === 'string' && typeof value.enabled === 'boolean' && Number.isSafeInteger(value.maxBytes) && value.maxBytes > 0);
      if (active) {
        setCapabilities(values);
        setCapabilityError(autoDetect ? !capabilityFor(values, 'image') || !capabilityFor(values, 'video') : !capabilityFor(values, kind));
      }
      return values;
    }).catch(() => { if (active) setCapabilityError(true); return []; }).finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [kind, autoDetect]);
  async function select(file?: File) {
    if (!file || pending || selecting.current) return;
    selecting.current = true; setPending(true); setError('');
    try {
      const currentCapabilities = await capabilityRequest.current ?? capabilities;
      let nextKind = kind;
      let nextFile = file;
      if (autoDetect) {
        const identified = await identifyLauncherMedia(file, { image: capabilityFor(currentCapabilities, 'image')?.maxBytes, video: capabilityFor(currentCapabilities, 'video')?.maxBytes });
        if (!identified.ok) throw new Error(identified.message);
        nextKind = identified.kind; nextFile = identified.file;
      } else {
        const validation = validateLocalMedia(file, kind, capabilityFor(currentCapabilities, kind)?.maxBytes);
        if (!validation.ok) throw new Error(validation.message);
      }
      setSelectedKind(nextKind);
      await saveMediaDraft(nextFile, nextKind, source);
      window.location.assign(workspacePath(nextKind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This file could not be saved. Choose it directly in the workspace.'); setPending(false);
    } finally { selecting.current = false; }
  }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void select(event.dataTransfer.files[0]); }
  return <div className="media-launcher" data-media-launcher={autoDetect ? 'auto' : kind}>
    {!autoDetect && <nav className="launcher-modes" aria-label="Watermark media type">
      <a href="/#tool" aria-current={kind === 'image' ? 'page' : undefined}><ImageIcon size={18} />Image</a>
      <a href="/video-watermark-remover#tool" aria-current={kind === 'video' ? 'page' : undefined}><Video size={18} />Video</a>
    </nav>}
    <div className={`launcher-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <CloudUpload className="launcher-upload-icon" size={38} strokeWidth={1.7} aria-hidden="true" />
      <button className="button button-primary" type="button" onClick={() => input.current?.click()} disabled={pending || !hydrated}><CloudUpload size={22} aria-hidden="true" />{!hydrated ? 'Preparing upload…' : pending ? 'Opening your workspace…' : autoDetect ? 'Upload file' : `Upload ${kind}`}</button>
      {autoDetect ? <p className="launcher-drop-copy"><strong>{labels.dropLabel}</strong><span> {labels.browseLabel}</span></p> : <LauncherPrompt kind={kind} copy={copy} />}
      <div className="launcher-requirements">{autoDetect ? <>
        <span>Images: JPG, PNG or WebP · up to {formatLauncherLimit(imageLimit)}</span>
        <span>Video: MP4 · up to {formatLauncherLimit(videoLimit)} · {videoCapability?.requiredFps ?? 24} fps · up to {Math.round((videoCapability?.maxDurationSeconds ?? 540) / 60)} min</span>
      </> : kind === 'video' ? <>MP4 · 24 fps · up to 9 min · {formatLauncherLimit(videoLimit)}</> : <>JPG, PNG or WebP · up to {formatLauncherLimit(imageLimit)}<br />Output: JPG</>}</div>
      <small><Info size={15} />Review the cost before processing.</small>
      <input ref={input} className="sr-only" data-testid="media-launcher-file" type="file" disabled={!hydrated || pending} aria-label={labels.fileInputLabel} accept={autoDetect ? 'image/jpeg,image/png,image/webp,video/mp4' : kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'} onChange={event => { void select(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {capabilityError && <p className="launcher-service-note" role="status">Current processing availability could not be checked. You can still prepare a file; the workspace checks before processing.</p>}
    {(autoDetect ? capabilities.filter(value => value.operation === 'image-watermark' || value.operation === 'video-watermark') : capability ? [capability] : []).filter(value => !value.enabled).map(value => <p className="launcher-service-note" key={value.operation}>{value.operation === 'video-watermark' ? 'Video' : 'Image'} processing: {value.reason ?? 'Temporarily unavailable. You can still prepare your file in the workspace.'}</p>)}
    {error && <div className="launcher-error" role="alert"><p>{error}</p><a href={workspacePath(selectedKind)}>Open {selectedKind} workspace <ArrowRight size={15} /></a></div>}
    <p className="launcher-local-note">Your file stays on this device until you sign in and upload.</p>
    <a className="launcher-workspace-link" href={workspacePath(selectedKind)}>Open workspace <ArrowRight size={15} /></a>
  </div>;
}
