import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, CloudUpload, Info } from 'lucide-react';
import { cleanExpiredMediaDrafts, saveMediaDraft, workspacePath, type MediaKind } from '../../lib/client/media-drafts';
import { formatLauncherLimit, identifyLauncherMedia, launcherLimit } from '../../lib/client/media-identification';
import type { MediaRecommendation } from '../../lib/client/media-recommendation';
import type { Capability } from '../workspace/workspace-api';
import './launcher.css';

// Public guide metadata only. App admission, balances and prices remain authoritative and uncached here.
let publicCapabilityRequest: Promise<Capability[]> | undefined;
function requestPublicCapabilities() {
  if (publicCapabilityRequest) return publicCapabilityRequest;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  publicCapabilityRequest = fetch('/api/v1/capabilities', { signal: controller.signal }).then(async response => {
    if (!response.ok) throw new Error('Capabilities unavailable');
    const body = await response.json() as { operations: Capability[] };
    if (!Array.isArray(body.operations)) throw new Error('Capabilities unavailable');
    return body.operations.filter(value => value && typeof value.operation === 'string' && typeof value.enabled === 'boolean' && Number.isSafeInteger(value.maxBytes) && value.maxBytes > 0);
  }).catch(error => { publicCapabilityRequest = undefined; throw error; }).finally(() => clearTimeout(timeout));
  return publicCapabilityRequest;
}

interface Props {
  source?: string; recommendation?: MediaRecommendation; compact?: boolean; buttonClassName?: string;
  onFileSelected?(file: File, kind: MediaKind): Promise<void>;
}
export default function MediaLauncher({ source = 'landing', recommendation, compact = false, buttonClassName = 'cta-button', onFileSelected }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const selecting = useRef(false);
  const mounted = useRef(false);
  const capabilityRequest = useRef<Promise<Capability[]> | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [capabilityError, setCapabilityError] = useState(false);
  const capabilityFor = (values: Capability[], kind: MediaKind) => values.find(value => value.operation === (kind === 'video' ? 'video-watermark' : 'image-watermark'));
  const imageLimit = launcherLimit('image', capabilityFor(capabilities, 'image')?.maxBytes);
  const videoCapability = capabilityFor(capabilities, 'video');
  const videoLimit = launcherLimit('video', videoCapability?.maxBytes);
  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    void cleanExpiredMediaDrafts().catch(() => {});
    let active = true;
    capabilityRequest.current = requestPublicCapabilities().then(values => {
      if (active) { setCapabilities(values); setCapabilityError(!capabilityFor(values, 'image') || !capabilityFor(values, 'video')); }
      return values;
    }).catch(() => { if (active) setCapabilityError(true); return []; });
    return () => { mounted.current = false; active = false; };
  }, []);
  async function select(file?: File) {
    if (!file || pending || selecting.current) return;
    selecting.current = true; setPending(true); setError('');
    try {
      const values = await capabilityRequest.current ?? capabilities;
      const identified = await identifyLauncherMedia(file, { image: capabilityFor(values, 'image')?.maxBytes, video: capabilityFor(values, 'video')?.maxBytes });
      if (!mounted.current) return;
      if (!identified.ok) throw new Error(identified.message);
      if (onFileSelected) { await onFileSelected(identified.file, identified.kind); setPending(false); }
      else {
        await saveMediaDraft(identified.file, identified.kind, source, undefined, recommendation);
        if (mounted.current) window.location.assign(workspacePath(identified.kind));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This file could not be saved. Choose it directly in the workspace.'); setPending(false); }
    finally { selecting.current = false; }
  }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); event.stopPropagation(); setDragging(false); void select(event.dataTransfer.files[0]); }
  const picker = <input ref={input} className="sr-only" data-testid={compact ? 'compact-launcher-file' : 'media-launcher-file'} type="file" disabled={!hydrated || pending} aria-label="Choose an image or MP4 video" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={event => { void select(event.target.files?.[0]); event.target.value = ''; }} />;
  const action = <button className={compact ? buttonClassName : 'button button-primary'} type="button" onClick={() => input.current?.click()} disabled={pending || !hydrated}><CloudUpload size={compact ? 18 : 22} aria-hidden="true" />{!hydrated ? 'Preparing upload…' : pending ? 'Opening your workspace…' : 'Upload file'}</button>;
  return <div className={`media-launcher${compact ? ' media-launcher-compact' : ''}`} data-media-launcher="auto">
    {compact ? <>{action}{picker}</> : <div className={`launcher-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <CloudUpload className="launcher-upload-icon" size={38} strokeWidth={1.7} aria-hidden="true" />{action}
      <p className="launcher-drop-copy"><strong>Drop an image or MP4 video here</strong><span> or click to browse</span></p>
      <div className="launcher-requirements"><span>Images: JPG, PNG or WebP · up to {formatLauncherLimit(imageLimit)}</span><span>Video: MP4 · up to {formatLauncherLimit(videoLimit)} · {videoCapability?.requiredFps ?? 24} fps · up to {Math.round((videoCapability?.maxDurationSeconds ?? 540) / 60)} min</span></div>
      <small><Info size={15} />Review the cost before processing.</small>{picker}
    </div>}
    {!compact && capabilityError && <p className="launcher-service-note" role="status">Current processing availability could not be checked. You can still prepare a file; the workspace checks before processing.</p>}
    {!compact && capabilities.filter(value => (value.operation === 'image-watermark' || value.operation === 'video-watermark') && !value.enabled).map(value => <p className="launcher-service-note" key={value.operation}>{value.operation === 'video-watermark' ? 'Video' : 'Image'} processing: {value.reason ?? 'Temporarily unavailable. You can still prepare your file in the workspace.'}</p>)}
    {error && <div className="launcher-error" role="alert"><p>{error}</p><a href="/app">Open workspace <ArrowRight size={15} /></a></div>}
    {!compact && <><p className="launcher-local-note">Your file stays on this device until you sign in and upload.</p>{!onFileSelected && <a className="launcher-workspace-link" href="/app">Open workspace <ArrowRight size={15} /></a>}</>}
  </div>;
}
