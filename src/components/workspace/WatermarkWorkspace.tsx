import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowRight, Brush, CloudUpload, Download, Eraser, FileImage, Image as ImageIcon, Info, LoaderCircle, LockKeyhole, Menu, Plus, RefreshCw, RotateCcw, Undo2, UserRound, Video, X, ZoomIn, ZoomOut } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { cleanExpiredMediaDrafts, clearMediaDrafts, deleteMediaDraft, readMediaDraft, saveMediaDraft, validateLocalMedia, type MediaDraft, type MediaKind } from '../../lib/client/media-drafts';
import { ImageMaskEditor, type MaskEditorHandle } from './ImageMaskEditor';
import { VideoEditor } from './VideoEditor';
import { canConfirmQuote, canRefineResult, canSubmitConfirmation, creditLabel, jobIsActive, processingLabel } from './workspace-state';
import { displayError, WorkspaceApiError, workspaceApi, type Capability, type MediaMetadata, type Operation, type PublicArtifact, type PublicJob, type PublicQuote, type PublicUpload } from './workspace-api';

interface Props { kind: MediaKind; logo: string; siteName: string }
const uploadPointer = (kind: MediaKind) => `watermarkgemini:upload:${kind}`;
const confirmationPointer = (kind: MediaKind) => `watermarkgemini:confirmation:${kind}`;
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
interface UploadContext { current(): boolean; stage(message: string): void; progress?(value: number): void }
function artifactInfo(artifact?: PublicArtifact) { if (!artifact) return ''; const value = artifact.metadata; return `${value.width} × ${value.height} · ${value.contentType === 'video/mp4' ? 'MP4' : value.contentType === 'image/jpeg' ? 'JPG' : value.contentType === 'image/png' ? 'PNG' : 'WebP'}${value.durationSeconds ? ` · ${value.durationSeconds.toFixed(1)} sec` : ''}${value.fps ? ` · ${value.fps} fps` : ''}`; }
function readLocalMetadata(file: File, kind: MediaKind): Promise<MediaMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    if (kind === 'image') { const image = new window.Image(); image.onload = () => { URL.revokeObjectURL(url); resolve({ kind, contentType: file.type, byteSize: file.size, width: image.naturalWidth, height: image.naturalHeight }); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be opened. Choose another JPG, PNG, or WebP.')); }; image.src = url; }
    else { const video = document.createElement('video'); video.preload = 'metadata'; video.onloadedmetadata = () => { const metadata: MediaMetadata = { kind, contentType: file.type, byteSize: file.size, width: video.videoWidth, height: video.videoHeight, durationSeconds: video.duration }; URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); if (!Number.isFinite(metadata.durationSeconds) || !metadata.width || !metadata.height) reject(new Error('This MP4 could not be opened.')); else resolve(metadata); }; video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Your browser could not preview this MP4. Choose a compatible video.')); }; video.src = url; }
  });
}
export default function WatermarkWorkspace({ kind, logo, siteName }: Props) {
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const [capabilities, setCapabilities] = useState<Capability[]>([]); const [capabilityError, setCapabilityError] = useState(false);
  const [balance, setBalance] = useState<{ freeUses: number; processingCredits: number } | null>(null);
  const [file, setFile] = useState<File | null>(null); const [draft, setDraft] = useState<MediaDraft | null>(null); const [localUrl, setLocalUrl] = useState(''); const [localMetadata, setLocalMetadata] = useState<MediaMetadata | null>(null); const [pendingUpload, setPendingUpload] = useState(false); const [mediaRevision, setMediaRevision] = useState(0);
  const [inputArtifact, setInputArtifact] = useState<PublicArtifact | null>(null); const [job, setJob] = useState<PublicJob | null>(null); const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [mode, setMode] = useState<'standard' | 'pro'>('standard'); const [fixedArea, setFixedArea] = useState(false); const [refining, setRefining] = useState(false);
  const [quote, setQuote] = useState<PublicQuote | null>(null); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [uploadProgress, setUploadProgress] = useState(0);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush'); const [brushSize, setBrushSize] = useState(36); const [showSelection, setShowSelection] = useState(true); const [hasSelection, setHasSelection] = useState(false); const [undoToken, setUndoToken] = useState(0);
  const [view, setView] = useState<'original' | 'result' | 'compare'>('original'); const [zoom, setZoom] = useState(100); const [menuOpen, setMenuOpen] = useState(false); const [loadingDraft, setLoadingDraft] = useState(true); const [uncertainSubmission, setUncertainSubmission] = useState(false);
  const [accountReady, setAccountReady] = useState(false); const [needsSignIn, setNeedsSignIn] = useState(false);
  const [preparationStatus, setPreparationStatus] = useState(''); const [preparationFailed, setPreparationFailed] = useState(false); const [preparationAttempt, setPreparationAttempt] = useState(0);
  const [quoteStatus, setQuoteStatus] = useState(''); const [quoteFailed, setQuoteFailed] = useState(false); const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0); const [selectionEditing, setSelectionEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null); const downloadLink = useRef<HTMLAnchorElement>(null); const mask = useRef<MaskEditorHandle>(null); const submitLock = useRef(false); const requests = useRef(new Set<XMLHttpRequest>()); const currentQuoteKey = useRef<{ quoteId: string; key: string; scope?: string } | null>(null);
  const uploadGeneration = useRef(0); const quoteGeneration = useRef(0); const viewGeneration = useRef(0); const readingFile = useRef(false); const restartUpload = useRef(false);
  const preparedMask = useRef<{ scope: string; artifact: PublicArtifact } | null>(null);
  const ownerId = session?.user?.id; const activeOwner = useRef(ownerId); activeOwner.current = ownerId;
  const operation: Operation = refining ? 'image-refine' : kind === 'video' ? 'video-watermark' : mode === 'pro' ? 'image-watermark-pro' : 'image-watermark';
  const capability = capabilities.find(value => value.operation === operation);
  const currentArtifact = refining && job?.result ? job.result : inputArtifact;
  const metadata = currentArtifact?.metadata ?? localMetadata;
  const previewUrl = currentArtifact?.previewUrl ?? localUrl;
  const readyResult = job?.status === 'READY' && !!job.result;
  const processing = !!job && jobIsActive(job.status);
  const selectedMedia = !!previewUrl;
  const canOperate = capability?.enabled === true;
  const quoteBalance = quote ? balance?.[quote.unit] : undefined;
  const balanceInsufficient = !!quote && quoteBalance !== undefined && quoteBalance < quote.amount;
  const editingLocked = !!busy || uncertainSubmission;
  const needsMask = refining || kind === 'video' && fixedArea;
  const parentJobId = refining ? job?.id : undefined;
  const quoteScope = JSON.stringify([ownerId, currentArtifact?.id, operation, parentJobId, needsMask, selectionRevision]);
  const activeQuoteScope = useRef(quoteScope); activeQuoteScope.current = quoteScope;
  const failedRefinement = !refining && job?.operation === 'image-refine' && ['FAILED', 'REFUNDED', 'EXPIRED'].includes(job.status);

  function invalidateQuote() { quoteGeneration.current += 1; currentQuoteKey.current = null; setQuote(null); setQuoteFailed(false); setQuoteStatus(''); }
  function selectionStarted() { if (submitLock.current || uncertainSubmission) return; invalidateQuote(); setSelectionEditing(true); setSelectionRevision(value => value + 1); }
  function selectionChanged(selected: boolean) { if (submitLock.current || uncertainSubmission) return; invalidateQuote(); setHasSelection(selected); setSelectionEditing(false); setSelectionRevision(value => value + 1); }
  function stopPreparation() { uploadGeneration.current += 1; for (const request of requests.current) request.abort(); setPreparationStatus(''); setPreparationFailed(false); setPendingUpload(false); }

  useEffect(() => {
    if (!quote || uncertainSubmission) return;
    const timeout = setTimeout(() => { if (!submitLock.current && currentQuoteKey.current?.quoteId === quote.id) { invalidateQuote(); setQuoteAttempt(value => value + 1); } }, Math.max(0, Date.parse(quote.expiresAt) - Date.now()) + 5);
    return () => clearTimeout(timeout);
  }, [quote, uncertainSubmission]);
  useEffect(() => { if (job?.status === 'READY') setView('result'); }, [job?.status]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  useEffect(() => () => { uploadGeneration.current += 1; quoteGeneration.current += 1; for (const request of requests.current) request.abort(); }, []);
  const refreshCapabilities = useCallback(async () => { try { const data = await workspaceApi<{ operations: Capability[] }>('/capabilities'); setCapabilities(data.operations); setCapabilityError(false); } catch { setCapabilityError(true); } }, []);
  const refreshAccount = useCallback(async () => { if (!ownerId) return; try { const next = await workspaceApi<{ freeUses: number; processingCredits: number }>('/me'); if (activeOwner.current === ownerId) setBalance(next); return next; } catch { if (activeOwner.current === ownerId) setBalance(null); } }, [ownerId]);
  const refreshJobs = useCallback(async () => { if (!ownerId) return; const response = await workspaceApi<{ jobs: PublicJob[] }>('/jobs'); if (activeOwner.current === ownerId) setJobs(response.jobs); return response.jobs; }, [ownerId]);
  function acceptJob(next: PublicJob) { setJob(next); if (next.input) setInputArtifact(next.input); if (next.operation === 'image-watermark-pro') setMode('pro'); else if (next.operation === 'image-watermark') setMode('standard'); setJobs(previous => [next, ...previous.filter(value => value.id !== next.id)]); }
  const refreshCurrentJob = useCallback(async (id: string) => { const revision = viewGeneration.current; const owner = activeOwner.current; const next = await workspaceApi<PublicJob>(`/jobs/${encodeURIComponent(id)}`); if (revision === viewGeneration.current && owner === activeOwner.current) acceptJob(next); return next; }, []);
  useEffect(() => {
    let cancelled = false;
    void refreshCapabilities();
    async function restore() {
      try {
        const pending = sessionStorage.getItem(confirmationPointer(kind));
        if (pending) { const saved = JSON.parse(pending) as { quote: PublicQuote; key: string }; if (saved.quote?.id && saved.key) { currentQuoteKey.current = { quoteId: saved.quote.id, key: saved.key }; setQuote(saved.quote); setUncertainSubmission(true); } }
        await cleanExpiredMediaDrafts();
        const existing = await readMediaDraft(kind);
        if (!cancelled && existing) { setDraft(existing); setFile(existing.file); setLocalUrl(URL.createObjectURL(existing.file)); const info = await readLocalMetadata(existing.file, kind); if (!cancelled) setLocalMetadata(info); }
      } catch (cause) { if (!cancelled) setNotice(displayError(cause)); }
      finally { if (!cancelled) setLoadingDraft(false); }
    }
    void restore(); return () => { cancelled = true; };
  }, [kind, refreshCapabilities]);
  useEffect(() => {
    let cancelled = false; setAccountReady(false);
    if (sessionPending) return;
    if (!ownerId) { setBalance(null); setAccountReady(true); return; }
    setNeedsSignIn(false); void refreshAccount(); void refreshJobs().catch(() => {});
    const id = new URLSearchParams(window.location.search).get('job');
    const restore = id ? refreshCurrentJob(id).catch(cause => { if (!cancelled) setError(displayError(cause)); }) : Promise.resolve();
    void restore.finally(() => { if (!cancelled) setAccountReady(true); });
    return () => { cancelled = true; };
  }, [ownerId, sessionPending, refreshAccount, refreshJobs, refreshCurrentJob]);
  useEffect(() => {
    if (!job || (!jobIsActive(job.status) && job.status !== 'UNKNOWN') || !session?.user) return;
    const timeout = setTimeout(() => { void refreshCurrentJob(job.id).then(() => refreshAccount()).catch(() => setNotice('Connection interrupted. Your task remains saved. Use Refresh status to reconnect.')); }, job.status === 'UNKNOWN' ? 15000 : 3000);
    return () => clearTimeout(timeout);
  }, [job, session?.user, refreshCurrentJob, refreshAccount]);
  useEffect(() => {
    const complete = async (data: unknown) => { if ((data as { type?: string })?.type !== 'clearmark-auth-complete') return; const confirmed = await authClient.getSession(); if (!confirmed.data?.user) { setError('Google sign-in could not be confirmed. Please try again.'); return; } await refetchSession(); setNeedsSignIn(false); setPreparationAttempt(value => value + 1); setQuoteAttempt(value => value + 1); setNotice('Signed in. We will prepare your file automatically. Click the processing button when you are ready.'); };
    const handler = (event: MessageEvent) => { if (event.origin === window.location.origin) void complete(event.data); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clearmark-auth');
    const broadcast = (event: MessageEvent) => void complete(event.data);
    window.addEventListener('message', handler); channel?.addEventListener('message', broadcast);
    return () => { window.removeEventListener('message', handler); channel?.close(); };
  }, [refetchSession]);

  useEffect(() => {
    if (!ownerId || !accountReady || loadingDraft || uncertainSubmission || needsSignIn || inputArtifact || job || (!file && !sessionStorage.getItem(uploadPointer(kind)))) return;
    let cancelled = false; const generation = ++uploadGeneration.current;
    const current = () => !cancelled && generation === uploadGeneration.current && activeOwner.current === ownerId;
    const context: UploadContext = { current, stage: value => { if (current()) setPreparationStatus(value); }, progress: value => { if (current()) setUploadProgress(value); } };
    setPreparationFailed(false); setUploadProgress(0); setPreparationStatus('Preparing your file');
    async function prepare() {
      try {
        const savedId = sessionStorage.getItem(uploadPointer(kind));
        let artifact: PublicArtifact;
        if (savedId) {
          context.stage('Checking your file');
          const saved = await workspaceApi<PublicUpload>(`/uploads/${encodeURIComponent(savedId)}`);
          if (!current()) return;
          if (saved.status === 'created') { restartUpload.current = true; throw new Error('The previous upload did not finish. Try again to upload your local file.'); }
          artifact = await waitForUpload(savedId, context, true, saved);
        } else {
          if (!file) throw new Error('Choose your file again to continue.');
          context.stage('Uploading your file'); artifact = await uploadBlob(file, kind, context);
        }
        if (!current()) return;
        setInputArtifact(artifact); setPendingUpload(false); setPreparationStatus('');
        if (draft) { await deleteMediaDraft(draft.id, kind).catch(() => {}); if (current()) setDraft(null); }
      } catch (cause) {
        if (!current()) return;
        setError(displayError(cause)); setPreparationFailed(true); setPreparationStatus('');
        if (cause instanceof WorkspaceApiError && cause.status === 401) setNeedsSignIn(true);
        if (cause instanceof WorkspaceApiError && [404, 410].includes(cause.status)) restartUpload.current = true;
      }
    }
    void prepare(); return () => { cancelled = true; };
  }, [ownerId, accountReady, loadingDraft, file, mediaRevision, preparationAttempt, uncertainSubmission, needsSignIn]);

  useEffect(() => {
    const generation = ++quoteGeneration.current;
    if (loadingDraft || uncertainSubmission || submitLock.current) return;
    currentQuoteKey.current = null; setQuote(null); setQuoteStatus(''); setQuoteFailed(false);
    if (!ownerId || !accountReady || !currentArtifact || !canOperate || processing || readyResult && !refining || failedRefinement || needsSignIn || needsMask && (!hasSelection || selectionEditing)) return;
    let cancelled = false;
    const scope = quoteScope; const artifactId = currentArtifact.id;
    const current = () => !cancelled && generation === quoteGeneration.current && activeOwner.current === ownerId && activeQuoteScope.current === scope && !submitLock.current;
    const context: UploadContext = { current, stage: value => { if (current()) setQuoteStatus(value); } };
    setQuoteStatus(needsMask ? 'Preparing your selection' : 'Calculating cost');
    const timeout = setTimeout(() => { void (async () => {
      try {
        let maskArtifact: PublicArtifact | undefined;
        if (needsMask) {
          const cached = preparedMask.current;
          if (cached?.scope === scope && Date.parse(cached.artifact.expiresAt) > Date.now()) maskArtifact = cached.artifact;
          else {
            const blob = await mask.current?.exportMask(); if (!current()) return;
            if (!blob) throw new Error('The selection could not be prepared.');
            maskArtifact = await uploadBlob(blob, 'mask', context, artifactId); if (!current()) return;
            preparedMask.current = { scope, artifact: maskArtifact };
          }
        }
        context.stage('Calculating cost');
        const next = await workspaceApi<PublicQuote>('/quotes', { operation, inputArtifactId: artifactId, ...(maskArtifact ? { maskArtifactId: maskArtifact.id } : {}), ...(parentJobId ? { parentJobId } : {}) });
        if (!current()) return;
        if (next.operation !== operation || !canConfirmQuote(next, false)) throw new Error('The processing cost could not be confirmed. Try again.');
        const available = await workspaceApi<{ freeUses: number; processingCredits: number }>('/me'); if (!current()) return;
        setBalance(available); currentQuoteKey.current = { quoteId: next.id, key: crypto.randomUUID(), scope }; setQuote(next); setQuoteStatus('');
      } catch (cause) {
        if (!current()) return;
        setError(displayError(cause)); setQuoteStatus(''); setQuoteFailed(true);
        if (cause instanceof WorkspaceApiError && cause.status === 401) setNeedsSignIn(true);
      }
    })(); }, needsMask ? 400 : 150);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [ownerId, accountReady, loadingDraft, currentArtifact?.id, operation, parentJobId, canOperate, processing, readyResult, refining, failedRefinement, needsMask, hasSelection, selectionEditing, selectionRevision, quoteScope, quoteAttempt, uncertainSubmission, needsSignIn]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0]; event.target.value = ''; if (!next) return;
    if (submitLock.current || uncertainSubmission || processing || readingFile.current) return;
    const validation = validateLocalMedia(next, kind, capabilities.find(value => value.operation === (kind === 'video' ? 'video-watermark' : 'image-watermark'))?.maxBytes);
    if (!validation.ok) { setError(validation.message); return; }
    readingFile.current = true; const revision = ++viewGeneration.current; stopPreparation(); invalidateQuote();
    setBusy('Opening your file'); setError(''); setNotice('');
    try {
      const info = await readLocalMetadata(next, kind);
      if (revision !== viewGeneration.current) return;
      if (kind === 'video' && (info.durationSeconds ?? 0) > 540) throw new Error('Choose an MP4 no longer than 9 minutes.');
      let stored: MediaDraft | null = null;
      try { stored = await saveMediaDraft(next, kind, '/app'); } catch { setNotice('This browser cannot keep a recovery draft. Keep this tab open until your file is uploaded.'); }
      if (draft && draft.id !== stored?.id) await deleteMediaDraft(draft.id, kind).catch(() => {});
      setDraft(stored); setFile(next); setLocalUrl(URL.createObjectURL(next)); setLocalMetadata(info); setInputArtifact(null); setJob(null); setRefining(false); setHasSelection(false); setSelectionEditing(false); setView('original'); setPendingUpload(false); setMediaRevision(value => value + 1); restartUpload.current = false;
      sessionStorage.removeItem(uploadPointer(kind)); window.history.replaceState({}, '', `/app/${kind}`);
    } catch (cause) { if (revision === viewGeneration.current) { setError(displayError(cause)); setPreparationAttempt(value => value + 1); setQuoteAttempt(value => value + 1); } }
    finally { readingFile.current = false; setBusy(''); }
  }
  async function signIn() {
    setError('');
    const popup = window.open('about:blank', 'clearmark-google-auth', 'popup=yes,width=520,height=680');
    if (!popup && file && !draft && !inputArtifact) { setError('Allow pop-ups to sign in while keeping this local file, or enable browser storage for draft recovery.'); return; }
    try {
      const response = await authClient.signIn.social({ provider: 'google', callbackURL: popup ? `${window.location.origin}/auth/popup` : window.location.href, disableRedirect: !!popup });
      if (response.error || (popup && !response.data?.url)) throw new Error('Unable to start Google sign-in. Please try again.');
      if (popup && response.data?.url) popup.location.href = response.data.url;
    } catch (cause) { popup?.close(); setError(displayError(cause)); }
  }
  async function signOut() { await clearMediaDrafts().catch(() => {}); sessionStorage.removeItem(uploadPointer('image')); sessionStorage.removeItem(uploadPointer('video')); sessionStorage.removeItem(confirmationPointer('image')); sessionStorage.removeItem(confirmationPointer('video')); await authClient.signOut(); window.location.replace(`/app/${kind}`); }
  async function discardDraft() {
    if (editingLocked) return; viewGeneration.current += 1; stopPreparation(); invalidateQuote();
    if (draft) await deleteMediaDraft(draft.id, kind).catch(() => {});
    setDraft(null); setFile(null); setLocalUrl(''); setLocalMetadata(null); setInputArtifact(null); setJob(null); setQuote(null); setNotice('Local draft removed from this browser.');
    sessionStorage.removeItem(uploadPointer(kind)); setPendingUpload(false);
  }
  async function waitForUpload(id: string, context: UploadContext, media: boolean, initial?: PublicUpload): Promise<PublicArtifact> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (!context.current()) throw new Error('Preparation superseded');
      const uploaded = attempt === 0 && initial ? initial : await workspaceApi<PublicUpload>(`/uploads/${encodeURIComponent(id)}`);
      if (!context.current()) throw new Error('Preparation superseded');
      if (uploaded.status === 'failed') {
        if (media) { restartUpload.current = true; setPendingUpload(false); }
        throw new Error(uploaded.error ?? 'This file is not compatible. Choose another file.');
      }
      if (uploaded.status === 'ready' && uploaded.artifact) return uploaded.artifact;
      await delay(2000);
    }
    throw new Error('Your file is still being checked. Try again to continue checking the same upload.');
  }
  async function uploadBlob(blob: Blob, uploadKind: 'image' | 'video' | 'mask', context: UploadContext, inputArtifactId?: string): Promise<PublicArtifact> {
    const created = await workspaceApi<{ id: string; uploadUrl: string }>('/uploads', { kind: uploadKind, contentType: blob.type, byteSize: blob.size, ...(inputArtifactId ? { inputArtifactId } : {}) });
    if (!context.current()) throw new Error('Preparation superseded');
    if (uploadKind !== 'mask') { sessionStorage.setItem(uploadPointer(kind), created.id); setPendingUpload(true); }
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest(); requests.current.add(request); request.open('PUT', created.uploadUrl); request.setRequestHeader('Content-Type', blob.type);
      request.upload.onprogress = event => { if (event.lengthComputable && context.current()) context.progress?.(Math.round(event.loaded / event.total * 100)); };
      request.onloadend = () => requests.current.delete(request);
      request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('The upload could not finish. Your local file is still available.'));
      request.timeout = 300000; request.ontimeout = () => reject(new Error('The upload timed out. Your file has not been processed. Please try again.'));
      request.onerror = () => reject(new Error('Connection interrupted while uploading. Try the upload again.')); request.onabort = () => reject(new Error('Upload stopped. Your file has not been processed.')); request.send(blob);
    });
    if (!context.current()) throw new Error('Preparation superseded');
    await workspaceApi(`/uploads/${encodeURIComponent(created.id)}/complete`, {});
    if (!context.current()) throw new Error('Preparation superseded');
    context.stage(uploadKind === 'mask' ? 'Checking your selection' : 'Checking your file');
    return waitForUpload(created.id, context, uploadKind !== 'mask');
  }
  function retryPreparation() {
    if (editingLocked) return; setError('');
    if (preparationFailed || !currentArtifact) {
      if (restartUpload.current) { sessionStorage.removeItem(uploadPointer(kind)); restartUpload.current = false; }
      setPreparationFailed(false); setPreparationAttempt(value => value + 1);
    } else { invalidateQuote(); setQuoteAttempt(value => value + 1); }
  }
  async function confirmProcessing() {
    if (!ownerId || !quote || submitLock.current || !canSubmitConfirmation(quote, !!busy, balanceInsufficient || quoteBalance === undefined, uncertainSubmission)) return;
    const key = currentQuoteKey.current; if (!key || key.quoteId !== quote.id) return;
    if (!uncertainSubmission && (key.scope !== activeQuoteScope.current || selectionEditing || preparationStatus || quoteStatus)) return;
    submitLock.current = true; setBusy('Confirming your task'); setError('');
    try {
      try { sessionStorage.setItem(confirmationPointer(kind), JSON.stringify({ quote, key: key.key, ownerId })); } catch { setNotice('Keep this tab open until the task is confirmed. This browser cannot save confirmation recovery.'); }
      const next = await workspaceApi<PublicJob>('/jobs', { quoteId: quote.id, idempotencyKey: key.key }); acceptJob(next); setQuote(null); setRefining(false); setHasSelection(false); mask.current?.clear(); setUncertainSubmission(false); setView('result'); window.history.replaceState({}, '', `/app/${kind}?job=${encodeURIComponent(next.id)}`); await refreshAccount();
      try { sessionStorage.removeItem(confirmationPointer(kind)); } catch { /* The accepted task is already persisted on the server. */ }
    } catch (cause) {
      if (!(cause instanceof WorkspaceApiError) || cause.status === 408 || cause.status >= 500 || uncertainSubmission && !['quote_expired', 'quote_changed', 'insufficient_balance'].includes(cause.code ?? '')) { setUncertainSubmission(true); setError(cause instanceof WorkspaceApiError && cause.status === 401 ? 'Sign in again to check this same submission. It will not create a second charge.' : 'The connection ended before confirmation arrived. Check this submission using the same confirmation; it will not create a second charge.'); if (cause instanceof WorkspaceApiError && cause.status === 401) setNeedsSignIn(true); }
      else {
        try { sessionStorage.removeItem(confirmationPointer(kind)); } catch { /* No processing was admitted. */ }
        setUncertainSubmission(false); setError(displayError(cause));
        if (cause.status === 401) setNeedsSignIn(true);
        if (['quote_expired', 'quote_changed', 'insufficient_balance'].includes(cause.code ?? '')) { invalidateQuote(); setQuoteAttempt(value => value + 1); void refreshAccount(); }
      }
    } finally { submitLock.current = false; setBusy(''); }
  }
  async function download() {
    if (!job || busy) return; setBusy('Preparing your download'); setError('');
    try { const signed = await workspaceApi<{ url: string; expiresAt: string }>(`/jobs/${encodeURIComponent(job.id)}/download`); const anchor = downloadLink.current; if (!anchor) throw new Error('The download could not start. Please try again.'); anchor.href = signed.url; anchor.download = kind === 'video' ? 'watermark-removed-video.mp4' : 'watermark-removed-image.jpg'; anchor.click(); }
    catch (cause) { setError(displayError(cause)); if (cause instanceof WorkspaceApiError && cause.status === 410) setJob(previous => previous ? { ...previous, status: 'EXPIRED' } : previous); } finally { setBusy(''); }
  }
  function startRefinement() { if (editingLocked || !job || !canRefineResult(job)) return; invalidateQuote(); setRefining(true); setHasSelection(false); setSelectionEditing(false); setView('result'); setError(''); }
  function cancelRefinement() { if (editingLocked) return; invalidateQuote(); setRefining(false); mask.current?.clear(); setHasSelection(false); setSelectionEditing(false); }
  function selectRecent(next: PublicJob) { if (editingLocked) return; viewGeneration.current += 1; stopPreparation(); invalidateQuote(); acceptJob(next); setFile(null); setLocalUrl(''); setLocalMetadata(null); setRefining(false); setHasSelection(false); setSelectionEditing(false); setView('result'); setError(''); window.history.replaceState({}, '', `/app/${kind}?job=${encodeURIComponent(next.id)}`); void refreshCurrentJob(next.id).catch(cause => setError(displayError(cause))); }
  const resultSrc = job?.result?.previewUrl;
  const imageSrc = refining ? resultSrc ?? previewUrl : readyResult && view !== 'original' ? resultSrc ?? previewUrl : previewUrl;
  const recent = jobs.filter(value => (value.operation === 'video-watermark') === (kind === 'video'));
  const actionLabel = refining ? 'Refine image' : 'Remove watermarks';
  const submissionDisabled = !canSubmitConfirmation(quote, !!busy, balanceInsufficient || quoteBalance === undefined, uncertainSubmission) || !uncertainSubmission && (!!preparationStatus || !!quoteStatus || selectionEditing || needsMask && !hasSelection || !canOperate);
  const actionBlock = <div className="workspace-action-block">
    {(preparationStatus || quoteStatus) && <p className="workspace-preparation-status" role="status" aria-live="polite"><LoaderCircle className="workspace-spinner" size={17} />{preparationStatus || quoteStatus}</p>}
    {preparationStatus === 'Uploading your file' && <progress aria-label="File upload progress" max={100} value={uploadProgress} />}
    {quote && <div className="workspace-inline-quote" aria-label="Processing cost"><strong>{creditLabel(quote.amount, quote.unit)}</strong><dl><div><dt>Your balance</dt><dd>{quoteBalance === undefined ? 'Checking…' : creditLabel(quoteBalance, quote.unit)}</dd></div><div><dt>Output</dt><dd>{quote.expectedOutput.format ?? (kind === 'video' ? 'MP4' : 'JPG')}{quote.expectedOutput.width ? ` · ${quote.expectedOutput.width} × ${quote.expectedOutput.height}` : ''}</dd></div></dl></div>}
    {balanceInsufficient && !uncertainSubmission && <p className="workspace-error" role="alert">You do not have enough {quote?.unit === 'freeUses' ? 'free image uses' : 'processing credits'}. No processing has started.{quote?.unit === 'processingCredits' ? ' Ask an administrator to allocate processing credits.' : ''}</p>}
    {uncertainSubmission && <p className="workspace-small">Check the same submission to recover its confirmation. This does not create another charge.</p>}
    {needsMask && !hasSelection && !uncertainSubmission && !preparationStatus && <p className="workspace-small">{refining ? 'Paint over the remaining watermark.' : 'Draw an area over the watermark.'} The cost will update automatically.</p>}
    <button className="button button-primary" type="button" onClick={() => void (!session?.user || needsSignIn ? signIn() : confirmProcessing())} disabled={!session?.user || needsSignIn ? !!busy || sessionPending : submissionDisabled}>{busy ? <LoaderCircle className="workspace-spinner" size={18} /> : refining ? <Brush size={18} /> : <ArrowRight size={18} />}{busy || (!session?.user || needsSignIn ? 'Sign in to continue' : uncertainSubmission ? 'Check submission' : quote ? `${actionLabel} · ${creditLabel(quote.amount, quote.unit)}` : actionLabel)}</button>
    {(preparationFailed || quoteFailed) && !uncertainSubmission && !needsSignIn && <button className="button button-ghost" type="button" onClick={retryPreparation} disabled={editingLocked}><RefreshCw size={16} />Try again</button>}
    {!uncertainSubmission && <p className="workspace-small">File checks are automatic and use no credits. Credits are reserved only when you click {refining ? 'Refine image' : 'Remove watermarks'}.</p>}
  </div>;

  return <div className="watermark-workspace">
    <a ref={downloadLink} className="sr-only" tabIndex={-1} aria-hidden="true">Download current result</a>
    <header className="site-header workspace-header"><a className="brand" href="/"><img className="brand-logo" src={logo} alt="" /><span>{siteName}</span></a><nav className="workspace-mode-nav" aria-label="Media workspace"><a href="/app/image" aria-current={kind === 'image' ? 'page' : undefined}><ImageIcon size={18} />Image</a><a href="/app/video" aria-current={kind === 'video' ? 'page' : undefined}><Video size={18} />Video</a></nav><div className="workspace-header-actions">{session?.user ? <button className="workspace-account" type="button" onClick={() => void signOut()} title="Sign out and clear local drafts">{session.user.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer" /> : <UserRound size={22} aria-hidden="true" />}<span>Sign out</span></button> : <button type="button" className="header-cta" disabled={sessionPending} onClick={() => void signIn()}>Sign in with Google</button>}<button className="workspace-menu-button" aria-label="Open menu" aria-expanded={menuOpen} type="button" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button></div>{menuOpen && <nav className="workspace-menu"><a href="/">Back to website</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>}</header>
    <div className="workspace-layout">
      <aside className="workspace-recent"><h2>Recent work</h2><button className="button button-primary" type="button" onClick={() => input.current?.click()} disabled={!!busy || processing || uncertainSubmission}><Plus size={18} />Upload {kind}</button>{!session?.user ? <p>Sign in to restore your recent tasks.</p> : recent.length === 0 ? <p>Your completed and in-progress tasks will appear here.</p> : <ul>{recent.map(value => <li key={value.id}><button type="button" className={job?.id === value.id ? 'is-selected' : ''} onClick={() => selectRecent(value)} disabled={!!busy || uncertainSubmission}>{value.input?.previewUrl && kind === 'image' ? <img src={value.input.previewUrl} alt="" /> : kind === 'video' ? <Video size={24} /> : <FileImage size={24} />}<span><strong>{value.operation === 'image-refine' ? 'Image refinement' : kind === 'video' ? 'Video removal' : 'Image removal'}</strong><small>{processingLabel(value.status)}</small></span></button></li>)}</ul>}<p className="workspace-retention"><LockKeyhole size={15} />Temporary files · download before expiry.</p></aside>
      <main className="workspace-main">
        <a className="workspace-back" href={kind === 'image' ? '/#tool' : '/video-watermark-remover'}><ArrowLeft size={16} />Back to website</a>
        <div className="workspace-title"><div><h1>{refining ? 'Refine your image' : kind === 'video' ? 'Remove video watermarks' : 'Remove image watermarks'}</h1><p>{refining ? 'Paint only over the remaining watermark. Your previous version stays available.' : readyResult ? 'Check the result before downloading.' : kind === 'video' ? 'Choose a video, adjust the area if needed, and remove watermarks in one click.' : 'Choose an image. We check the file and show its cost automatically.'}</p></div>{balance && <div className="workspace-balances"><span>{balance.freeUses} free image uses</span><span>{balance.processingCredits} processing credits</span></div>}</div>
        <input className="sr-only" ref={input} type="file" aria-label={`Upload ${kind} to workspace`} accept={kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'} onChange={event => void chooseFile(event)} />
        {error && <div className="workspace-error" role="alert"><Info size={18} /><p>{error}</p><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}
        {notice && <div className="workspace-notice" role="status"><Info size={17} /><p>{notice}</p><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {capabilityError && <div className="workspace-notice">Processing availability could not be loaded.<button type="button" onClick={() => void refreshCapabilities()}>Try again</button></div>}
        {loadingDraft ? <div className="workspace-empty"><LoaderCircle className="workspace-spinner" size={28} /><p>Opening your workspace…</p></div> : !selectedMedia && !uncertainSubmission && !pendingUpload && !preparationStatus && !preparationFailed ? <div className="workspace-empty"><CloudUpload size={42} /><h2>Choose your {kind}</h2><p>{kind === 'image' ? 'JPG, PNG or WebP · up to 10 MB · output JPG' : 'MP4 · 24 fps · up to 9 minutes · up to 100 MB'}</p><button className="button button-primary" type="button" onClick={() => input.current?.click()}><CloudUpload size={20} />Upload {kind}</button><small>File checks are automatic. You choose when to process.</small></div> : <>
          <div className={`workspace-editor-grid ${refining ? 'is-refining' : ''}`}>
            {refining && <div className="workspace-tools" aria-label="Refinement tools"><button type="button" aria-pressed={tool === 'brush'} onClick={() => setTool('brush')} disabled={editingLocked}><Brush size={22} />Brush</button><button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} disabled={editingLocked}><Eraser size={22} />Eraser</button><button type="button" onClick={() => { selectionStarted(); setUndoToken(value => value + 1); }} disabled={editingLocked}><Undo2 size={22} />Undo</button><button type="button" onClick={() => mask.current?.clear()} disabled={editingLocked}><RotateCcw size={22} />Clear</button></div>}
            <section className="workspace-stage-panel" aria-label="Media editor">
              {kind === 'image' && <div className="workspace-stage-toolbar"><div className="workspace-view-tabs" aria-label="Image view">{(['original', 'result', 'compare'] as const).map(value => <button key={value} type="button" aria-pressed={view === value} disabled={!readyResult || refining} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div><div className="workspace-zoom"><button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(50, value - 25))}><ZoomOut size={17} /></button><span>{zoom}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(300, value + 25))}><ZoomIn size={17} /></button><button type="button" onClick={() => setZoom(100)}>Fit</button></div></div>}
              {kind === 'image' && metadata && <div className={`workspace-image-scroll ${view === 'compare' && readyResult && !refining ? 'is-comparing' : ''}`}><div style={{ width: zoom === 100 ? '100%' : `${zoom}%`, minWidth: zoom === 100 ? undefined : `${zoom}%` }}>{view === 'compare' && readyResult && !refining ? <div className="workspace-image-comparison"><figure><figcaption>Original</figcaption><img src={previewUrl} alt="Original image" /></figure><figure><figcaption>Result</figcaption><img src={resultSrc} alt="Watermark removal result" /></figure></div> : <ImageMaskEditor key={`${currentArtifact?.id ?? draft?.id ?? 'local'}:${refining}`} ref={mask} src={imageSrc} width={refining ? job?.result?.metadata.width ?? metadata.width : metadata.width} height={refining ? job?.result?.metadata.height ?? metadata.height : metadata.height} editable={refining} disabled={editingLocked} tool={tool} brushSize={brushSize} showSelection={showSelection} onSelection={selectionChanged} onSelectionStart={selectionStarted} undoToken={undoToken} />}</div></div>}
              {kind === 'video' && metadata && <VideoEditor key={`${job?.id ?? mediaRevision}:${readyResult}`} ref={mask} src={previewUrl} resultSrc={readyResult ? resultSrc : undefined} width={metadata.width} height={metadata.height} duration={metadata.durationSeconds} fixedArea={fixedArea && !readyResult && !processing} disabled={editingLocked} onSelection={selectionChanged} onSelectionStart={selectionStarted} />}
              <div className="workspace-file-info"><span>{file?.name ?? (kind === 'image' ? 'Image' : 'Video')}</span><span>{currentArtifact ? artifactInfo(currentArtifact) : metadata ? `${metadata.width} × ${metadata.height}${metadata.durationSeconds ? ` · ${metadata.durationSeconds.toFixed(1)} sec` : ''} · Local preview` : ''}</span></div>
              {readyResult && <p className="workspace-media-caption">{artifactInfo(job?.result)}{job?.result?.metadata.kind === 'video' ? ` · ${job.result.metadata.hasAudio ? 'Audio present' : 'No audio track'}` : ''}{job?.isDemo ? ' · Test result from Mock Provider' : ''}</p>}
              {readyResult && recent.length > 1 && <div className="workspace-versions"><span>Previous versions</span>{recent.filter(value => value.status === 'READY' && value.id !== job?.id && (value.id === job?.parentJobId || value.parentJobId === job?.id || value.parentJobId === job?.parentJobId && !!job?.parentJobId)).map(value => <button type="button" key={value.id} onClick={() => selectRecent(value)}>{value.result?.previewUrl && kind === 'image' && <img src={value.result.previewUrl} alt="" />}<span>Result · {new Date(value.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>}
            </section>
            <aside className="workspace-controls">
              {uncertainSubmission ? <><h2>Check your saved submission</h2>{actionBlock}</> : refining ? <><h2>Refine selected area</h2><p>Paint only over the watermark.</p><label className="workspace-range-label">Brush size <span>{brushSize} px</span><input type="range" min={4} max={160} value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} disabled={editingLocked} /></label><label className="workspace-switch">Show selection<input type="checkbox" checked={showSelection} onChange={event => setShowSelection(event.target.checked)} disabled={editingLocked} /></label>{actionBlock}<button className="workspace-text-button" type="button" onClick={cancelRefinement} disabled={editingLocked}>Keep current version</button></> : processing || job?.status === 'UNKNOWN' ? <><h2>{processingLabel(job?.status ?? '')}</h2>{processing && <LoaderCircle className="workspace-spinner" size={30} />}{typeof job?.progress === 'number' && job.status === 'PROCESSING' ? <><progress aria-label="Provider processing progress" max={1} value={job.progress} /><p>{Math.round(job.progress * 100)}%</p></> : <p>{job?.status === 'UNKNOWN' ? 'The provider has not confirmed this request. We are checking it. Do not start it again.' : 'You can leave this page and return to this task from Recent work.'}</p>}<button className="button button-ghost" type="button" onClick={() => job && void refreshCurrentJob(job.id).catch(cause => setError(displayError(cause)))}><RefreshCw size={17} />Refresh status</button><p className="workspace-small">{job?.charge ? `${creditLabel(job.charge.amount, job.charge.unit)} · ${job.charge.status}` : ''}</p></> : readyResult ? <><h2>Download result</h2><p>{artifactInfo(job?.result)}</p><button className="button button-primary" type="button" onClick={() => void download()} disabled={!!busy}><Download size={19} />{busy === 'Preparing your download' ? 'Preparing…' : `Download ${kind === 'video' ? 'video' : 'JPG'}`}</button>{job?.result?.expiresAt && <p className="workspace-small">Available until {new Date(job.result.expiresAt).toLocaleString()}</p>}<button className="button button-ghost" type="button" disabled={!!busy} onClick={() => job && void refreshCurrentJob(job.id).catch(cause => setError(displayError(cause)))}><RefreshCw size={16} />Refresh preview link</button>{kind === 'image' && job && canRefineResult(job) && <button className="workspace-text-button" type="button" onClick={startRefinement} disabled={!capabilities.find(value => value.operation === 'image-refine')?.enabled}><Brush size={17} />Refine remaining marks</button>}{kind === 'video' && <button className="workspace-text-button" type="button" onClick={() => { if (editingLocked) return; invalidateQuote(); setJob(null); setHasSelection(false); setFixedArea(true); mask.current?.clear(); window.history.replaceState({}, '', '/app/video'); }} disabled={editingLocked}><RefreshCw size={17} />Adjust area & process again</button>}<p className="workspace-small">Each new processing task shows its cost on the button.</p></> : <>
                <h2>{kind === 'video' ? 'Choose what to remove' : 'Choose cleanup quality'}</h2>
                {kind === 'video' ? <><label className="workspace-radio"><input type="radio" name="video-mode" checked={!fixedArea} onChange={() => { if (editingLocked) return; invalidateQuote(); setFixedArea(false); mask.current?.clear(); }} disabled={editingLocked} /><span><strong>Automatic detection</strong><small>Let AI find visible watermarks.</small></span></label><label className="workspace-radio"><input type="radio" name="video-mode" checked={fixedArea} onChange={() => { if (editingLocked) return; invalidateQuote(); setFixedArea(true); }} disabled={editingLocked} /><span><strong>Fixed area</strong><small>For watermarks that stay in one place.</small></span></label><p className="workspace-small">The area applies to the entire video. Moving-watermark tracking is not supported.</p></> : <><label className="workspace-radio"><input type="radio" name="image-mode" checked={mode === 'standard'} onChange={() => { if (editingLocked) return; invalidateQuote(); setMode('standard'); setError(''); }} disabled={editingLocked} /><span><strong>Standard</strong><small>Automatic cleanup · uses a free image use when available.</small></span></label><label className="workspace-radio"><input type="radio" name="image-mode" checked={mode === 'pro'} onChange={() => { if (editingLocked) return; invalidateQuote(); setMode('pro'); setError(''); }} disabled={editingLocked || !capabilities.find(value => value.operation === 'image-watermark-pro')?.enabled} /><span><strong>PRO</strong><small>Higher-quality model · processing credits. {capabilities.find(value => value.operation === 'image-watermark-pro')?.enabled ? '' : 'Currently unavailable.'}</small></span></label><p className="workspace-small">Output JPG. Transparency is flattened to white. Prepare an image with its longest edge at 6000 px or less.</p></>}
                {!failedRefinement && actionBlock}
                {failedRefinement && <p className="workspace-small">Open your previous version in Recent work to refine it again.</p>}
                {capability && !canOperate && <p className="workspace-small">{capability.reason ?? 'This operation is not available yet. Your file has not been processed.'}</p>}
                {job && ['FAILED', 'REFUNDED', 'EXPIRED'].includes(job.status) && <div className="workspace-task-failure"><h3>{processingLabel(job.status)}</h3><p>{job.error}</p><p>{job.charge.status === 'refunded' ? 'Your reserved credits were returned.' : `Credit status: ${job.charge.status}.`}</p>{job.status === 'EXPIRED' && <p>Choose the original file to prepare a new task.</p>}</div>}
              </>}
              {!processing && !uncertainSubmission && <button className="workspace-replace" type="button" onClick={() => input.current?.click()} disabled={!!busy}><CloudUpload size={16} />Replace {kind}</button>}
              {file && !inputArtifact && !processing && !uncertainSubmission && <button className="workspace-text-button" type="button" onClick={() => void discardDraft()} disabled={!!busy}>Discard local draft</button>}
            </aside>
          </div>
        </>}
      </main>
    </div>

  </div>;
}
