import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, CloudUpload, Download, LoaderCircle, Monitor, X } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { listenForAuthCompletion } from '../../lib/client/auth-completion';
import { identifyLauncherMedia } from '../../lib/client/media-identification';
import { clearMediaDrafts, deleteMediaDraft, readMediaDraft, savePaidHandoff } from '../../lib/client/media-drafts';
import { paidHandoffPath, paidHandoffReason, type LocalMediaInfo, type PaidCapability } from '../../lib/client/free-gemini';
import { localOperationCatalog } from '../../lib/contracts/operation-catalog';
import { runGemini } from '../../lib/client/gemini-engine';
import { createGeminiEvents } from '../../lib/client/gemini-events';
import { GeminiVideoCompare } from './GeminiVideoCompare';

interface Media { file: File; url: string; info: LocalMediaInfo }
interface Result { url: string; blob: Blob; info: LocalMediaInfo; bestEffort?: boolean }
export default function FreeGeminiWorkspace({ logo, siteName }: { logo: string; siteName: string }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [media, setMedia] = useState<Media | null>(null); const [result, setResult] = useState<Result | null>(null);
  const [phase, setPhase] = useState<'idle' | 'checking' | 'processing'>('idle'); const [stage, setStage] = useState(''); const [progress, setProgress] = useState<number | undefined>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [mobileView, setMobileView] = useState('result');
  const [capabilities, setCapabilities] = useState<(PaidCapability & { operation: string })[]>([]);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null); const generation = useRef(0); const locked = useRef(false);
  const owner = useRef<string | undefined>(undefined); const currentOwner = useRef(session?.user.id); currentOwner.current = session?.user.id;
  const urls = useRef<string[]>([]); const paidWindow = useRef<Window | null>(null); const alive = useRef(true);
  const draftRestored = useRef(false);
  const [emit] = useState(() => createGeminiEvents());
  const run = useRef<{ id: string; kind: 'image' | 'video'; started: number } | null>(null);
  const resultRun = useRef('');
  useEffect(() => { emit('visit', 'unselected'); }, [emit]);
  function localUrl(blob: Blob) { const url = URL.createObjectURL(blob); urls.current.push(url); return url; }
  function clear() { generation.current++; controller.current?.abort(); controller.current = null; locked.current = false; run.current = null; resultRun.current = ''; for (const url of urls.current) URL.revokeObjectURL(url); urls.current = []; setMedia(null); setResult(null); setFailed(false); setPhase('idle'); setError(''); setNotice(''); paidWindow.current = null; }
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; controller.current?.abort(); for (const url of urls.current) URL.revokeObjectURL(url); }; }, []);
  useEffect(() => {
    if (isPending) return;
    if (owner.current && session?.user.id && owner.current !== session.user.id) clear();
    if (session?.user.id) owner.current = session.user.id;
  }, [session?.user.id, isPending]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/v1/capabilities', { signal: abort.signal }).then(async response => { if (!response.ok) return; const value = await response.json(); if (alive.current && Array.isArray(value.operations)) setCapabilities(value.operations.filter((item: PaidCapability) => item && Array.isArray(item.acceptedTypes) && Number.isFinite(item.maxBytes))); }).catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    return listenForAuthCompletion({ target: window, channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clearmark-auth'), once: false, confirm: async () => Boolean((await authClient.getSession()).data?.user), onConfirmed: async () => { await refetch(); emit('login', 'unselected'); setNotice('Signed in. Click Remove watermark — Free when you are ready.'); }, onRejected: () => setError('Sign-in could not be confirmed. Your file is still here.') });
  }, [refetch]);
  useEffect(() => {
    if (isPending || draftRestored.current) return;
    let active = true;
    void (async () => {
      for (const kind of ['image', 'video'] as const) {
        const draft = await readMediaDraft(kind, currentOwner.current).catch(() => null);
        if (!active) return;
        if (draft?.source === '/app/free/gemini' && !draft.handoff && !locked.current) { draftRestored.current = true; await chooseFile(draft.file); await deleteMediaDraft(draft.id, kind).catch(() => {}); break; }
      }
      if (active) draftRestored.current = true;
    })();
    return () => { active = false; };
  }, [isPending]);
  async function chooseFile(file?: File) {
    if (!file || locked.current || handoffBusy || isPending) return;
    locked.current = true; const epoch = ++generation.current; const selectedOwner = currentOwner.current;
    controller.current = new AbortController(); setPhase('checking'); setStage('Checking your file'); setError(''); setNotice('');
    try {
      const identified = await identifyLauncherMedia(file, { image: localOperationCatalog['gemini-image-free'].capability.maxBytes, video: localOperationCatalog['gemini-video-free'].capability.maxBytes });
      if (!identified.ok) throw new Error(identified.message);
      const checked = await runGemini(identified.file, 'inspect', controller.current.signal);
      if (!alive.current || epoch !== generation.current || selectedOwner !== currentOwner.current) return;
      for (const url of urls.current) URL.revokeObjectURL(url); urls.current = [];
      if (result) emit('reuse', checked.info.kind);
      setMedia({ file: identified.file, info: checked.info, url: localUrl(identified.file) }); setResult(null); setFailed(false); paidWindow.current = null;
      emit('selected', checked.info.kind); run.current = null; resultRun.current = '';
    } catch (cause) { if (alive.current && epoch === generation.current) setError(cause instanceof Error ? cause.message : 'This file could not be opened.'); }
    finally { if (alive.current && epoch === generation.current) { locked.current = false; setPhase('idle'); } }
  }
  async function signIn() {
    setError('');
    const popup = window.open('', 'gemini-google-sign-in', 'popup,width=520,height=680');
    if (!popup) { setError('Allow the Google sign-in window to keep your local file on this page.'); return; }
    try {
      const response = await authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}/auth/popup`, disableRedirect: true });
      if (response.error || !response.data?.url) throw new Error('Google sign-in could not start. Try again.');
      popup.location.href = response.data.url;
    } catch (cause) { popup.close(); setError(cause instanceof Error ? cause.message : 'Sign-in could not start.'); }
  }
  async function process() {
    if (!media || locked.current || handoffBusy || isPending) return;
    if (!session?.user) { await signIn(); return; }
    locked.current = true; const epoch = ++generation.current; const processingOwner = session.user.id;
    run.current = null;
    setFailed(false);
    controller.current = new AbortController(); setError(''); setNotice(''); setPhase('processing'); setStage('Starting local processing'); setProgress(undefined);
    try {
      const verified = await authClient.getSession();
      if (epoch !== generation.current) return;
      if (verified.data?.user.id !== processingOwner) throw new Error('Sign in with the same account before starting processing. Your file is still here.');
      run.current = { id: crypto.randomUUID(), kind: media.info.kind, started: performance.now() };
      emit('start', media.info.kind, run.current.id);
      const next = await runGemini(media.file, 'process', controller.current.signal, (label, value) => { if (alive.current && epoch === generation.current) { setStage(label); setProgress(value); } });
      if (!next.blob) throw new Error('No downloadable result was produced. Your original is unchanged.');
      // Normal session expiry keeps an authenticated run; explicit sign-out/account change cancels its epoch.
      if (alive.current && epoch === generation.current && owner.current === processingOwner) { resultRun.current = run.current.id; emit('result', next.info.kind, run.current.id, performance.now() - run.current.started); setResult({ blob: next.blob, url: localUrl(next.blob), info: next.info, bestEffort: next.bestEffort }); setMobileView('result'); }
    } catch (cause) { if (alive.current && epoch === generation.current) { const message = cause instanceof Error ? cause.message : 'Processing failed. Your original is unchanged.'; setError(message); if (run.current) { setFailed(true); resultRun.current = run.current.id; emit(/No supported|置信度/.test(message) ? 'not_detected' : 'failed', run.current.kind, run.current.id, performance.now() - run.current.started); } } }
    finally { if (alive.current && epoch === generation.current) { locked.current = false; setPhase('idle'); } }
  }
  function cancel() { generation.current++; controller.current?.abort(); if (run.current && phase === 'processing') emit('cancelled', run.current.kind, run.current.id, performance.now() - run.current.started); run.current = null; locked.current = false; setPhase('idle'); setNotice('Cancelled. Your original file is still available.'); }
  async function handoff() {
    if (!media || (!result && !failed) || !session?.user || handoffBusy || reason) return;
    emit('paid_entry', media.info.kind, resultRun.current);
    if (paidWindow.current && !paidWindow.current.closed) { paidWindow.current.focus(); return; }
    const nextWindow = window.open('about:blank', `gemini-paid-${crypto.randomUUID()}`);
    if (!nextWindow) { setError('Allow a new tab to keep this page open while you use the cloud tool.'); return; }
    nextWindow.opener = null;
    setHandoffBusy(true); setError(''); const active = session.user.id;
    try {
      if ((await authClient.getSession()).data?.user.id !== active || currentOwner.current !== active) throw new Error('Sign in with the same account before continuing.');
      const draft = await savePaidHandoff(media.file, media.info.kind, active);
      if (!alive.current || currentOwner.current !== active) throw new Error('The account changed. Return to the free tool to continue.');
      nextWindow.location.href = paidHandoffPath(draft); paidWindow.current = nextWindow;
    } catch (cause) { nextWindow.close(); if (alive.current) setError(cause instanceof Error ? cause.message : 'The file handoff could not be saved. Your original file is still here.'); }
    finally { if (alive.current) setHandoffBusy(false); }
  }
  async function signOut() { clear(); owner.current = undefined; await clearMediaDrafts().catch(() => {}); await authClient.signOut(); await refetch(); }
  const kind = media?.info.kind ?? 'image'; const busy = phase !== 'idle';
  const capability = capabilities.find(value => value.operation === (kind === 'video' ? 'video-watermark' : 'image-watermark'));
  const reason = media ? paidHandoffReason(media.file, media.info, capability) : null;
  useEffect(() => { if ((result || failed) && media && !reason) emit('paid_shown', media.info.kind, resultRun.current); }, [result, failed, media, reason, emit]);
  const info = result?.info ?? media?.info;
  return <div className="free-gemini" data-free-gemini>
    <header className="gemini-header"><a className="brand" href="/"><img className="brand-logo" src={logo} alt="" /><span>{siteName}</span></a><span className="gemini-tool-label">Free Gemini tool</span><div className="gemini-account">{session?.user ? <><span className="gemini-avatar" aria-label="Signed-in account">{session.user.name?.slice(0, 1) || 'G'}</span><button type="button" onClick={() => void signOut()}>Sign out</button></> : <button type="button" disabled={isPending} onClick={() => void signIn()}>Sign in with Google</button>}</div></header>
    <main className="gemini-main" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!busy) void chooseFile(event.dataTransfer.files[0]); }}>
      <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" aria-label="Choose a Gemini image or video" disabled={busy || handoffBusy || isPending} onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="gemini-heading"><div><h1>{result ? `Your ${kind} is ready` : 'Free Gemini watermark remover'}</h1><p>{info ? `${info.width} × ${info.height} · ${kind === 'video' ? 'MP4' : result ? 'PNG' : media?.file.type.split('/')[1].toUpperCase()}${result?.info.hasAudio ? ' · Audio preserved' : ''}` : 'Remove visible Gemini watermarks from images and videos.'}</p></div><div className="gemini-actions">{result ? <a className="button button-primary" href={result.url} onClick={() => emit('download_started', kind, resultRun.current)} download={`gemini-cleaned-${kind}.${kind === 'video' ? 'mp4' : 'png'}`}><Download size={21} />Download {kind === 'video' ? 'MP4' : 'PNG'} — Free</a> : media && !busy ? <button className="button button-primary" type="button" disabled={isPending} onClick={() => void process()}>{session?.user ? 'Remove watermark — Free' : 'Sign in to process for free'}</button> : null}{media && <button className="gemini-text-button" type="button" disabled={busy || handoffBusy || isPending} onClick={() => input.current?.click()}>{result ? 'Process another file' : 'Choose another file'}</button>}</div></div>
      {error && <p className="gemini-error" role="alert">{error}</p>}{notice && <p className="gemini-notice" role="status">{notice}</p>}
      {busy && <div className="gemini-progress" role="status" aria-live="polite"><LoaderCircle className="gemini-spinner" size={20} /><span>{stage}</span>{typeof progress === 'number' && <progress aria-label="Local processing progress" max={1} value={progress} />}<button type="button" onClick={cancel}><X size={16} />Cancel</button><small>Keep this page open. Your file stays on this device.</small></div>}
      {!media ? <div className="gemini-intake"><CloudUpload size={40} strokeWidth={1.6} /><h2>Choose a Gemini image or video</h2><p>JPG, PNG, WebP up to 10 MB · MP4 up to 100 MB</p><button className="button button-primary" type="button" disabled={busy} onClick={() => input.current?.click()}>Choose file</button><small>Free, unlimited uses after sign-in. Processed on your device.</small></div> : <>
        {result && <div className="gemini-mobile-tabs" aria-label="Preview view">{['original', 'result'].map(view => <button key={view} type="button" aria-pressed={mobileView === view} onClick={() => setMobileView(view)}>{view === 'original' ? 'Original' : 'Result'}</button>)}</div>}
        {kind === 'video' && result ? <GeminiVideoCompare key={result.url} original={media.url} result={result.url} mobileView={mobileView} /> : <div className={`gemini-comparison ${result ? `mobile-${mobileView}` : 'gemini-single'}`}><figure className="gemini-original"><figcaption>Original</figcaption>{kind === 'video' ? <video src={media.url} controls preload="metadata" playsInline /> : <img src={media.url} alt="Original image" />}</figure>{result && <figure className="gemini-result"><figcaption>Result</figcaption><img src={result.url} alt="Gemini watermark removal result" /></figure>}</div>}
        {result?.bestEffort && <p className="gemini-note">Some marks may remain. Compare the result before downloading.</p>}
        <div className="gemini-assurances"><span><Monitor size={18} />Processed on your device</span><span><CheckCircle2 size={18} />Free · No credits used</span>{result?.info.hasAudio && <span><CheckCircle2 size={18} />Audio preserved</span>}</div>
        {(result || failed) && <div className="gemini-paid">{reason ? <p>{reason} {result ? 'Your free download is still available.' : 'Your original file is unchanged.'}</p> : <><p>{result ? 'Still see a watermark?' : 'Need another option?'} <button type="button" onClick={() => void handoff()} disabled={handoffBusy || !session?.user}>Try paid AI removal <ArrowUpRight size={14} /></button></p><small>Uploads your original to the cloud. Review the cost before processing.</small></>}</div>}
      </>}
      <p className="gemini-scope">Gemini visible watermarks only. Results depend on the source file. Video is re-encoded.</p>
    </main>
  </div>;
}
