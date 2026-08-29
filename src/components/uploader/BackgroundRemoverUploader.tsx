import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Columns2, CloudUpload, Download, LockKeyhole, Palette, Trash2 } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { putFileWithRetry } from '../../lib/upload/direct-upload';
import { MAX_UPLOAD_BYTES, validateUploadMetadata } from '../../lib/upload/validation';
import type { UploaderCopy } from '../../lib/content/site-settings';
import { initialUploadState, uploadReducer } from './upload-machine';

type JsonRecord = Record<string, unknown>;
type BackgroundChoice = { id: string; label: string; color: string | null };
type CompletedJobLinks = { status: string; resultUrl?: string; downloadUrl?: string; error?: string };

interface Props {
  logo: string;
  siteName: string;
  copy: UploaderCopy;
}

const PRESET_BACKGROUNDS: BackgroundChoice[] = [
  { id: 'transparent', label: 'Transparent background', color: null },
  { id: 'white', label: 'White background', color: '#ffffff' },
  { id: 'black', label: 'Black background', color: '#111827' },
  { id: 'gray', label: 'Light gray background', color: '#e5e7eb' },
  { id: 'blue', label: 'Blue background', color: '#3975ff' },
  { id: 'sky', label: 'Sky blue background', color: '#8ed8ff' },
  { id: 'mint', label: 'Mint background', color: '#72ddb5' },
  { id: 'yellow', label: 'Yellow background', color: '#ffd54a' },
  { id: 'coral', label: 'Coral background', color: '#ff8a72' },
  { id: 'violet', label: 'Violet background', color: '#9b6de3' },
];
const TRANSPARENT_BACKGROUND = PRESET_BACKGROUNDS[0]!;

async function api<T extends JsonRecord>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
  return body;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCopy(template: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
}

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof TypeError && error.message === 'Failed to fetch') return fallback;
  return error instanceof Error ? error.message : fallback;
}

async function downloadWithBackground(resultUrl: string, color: string): Promise<void> {
  const response = await fetch(resultUrl);
  if (!response.ok) throw new Error('The result could not be prepared for download.');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare this download.');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Your browser could not prepare this download.')), 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'background-removed-image.png';
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BackgroundRemoverUploader({ logo, siteName, copy }: Props) {
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [selectedBackground, setSelectedBackground] = useState<BackgroundChoice>(TRANSPARENT_BACKGROUND);
  const [customColor, setCustomColor] = useState('#f3f6ff');
  const [showOriginal, setShowOriginal] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [refreshingResult, setRefreshingResult] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toolRef = useRef<HTMLElement>(null);
  const automaticResultRefreshAttemptedRef = useRef(false);

  const expanded = Boolean(state.previewUrl);

  useEffect(() => {
    const hero = toolRef.current?.closest('.hero-inner');
    if (!hero) return;
    hero.classList.toggle('is-tool-expanded', expanded);
    return () => hero.classList.remove('is-tool-expanded');
  }, [expanded]);

  useEffect(() => () => {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  }, [state.previewUrl]);

  const selectFile = useCallback((nextFile: File) => {
    const result = validateUploadMetadata({ contentType: nextFile.type, size: nextFile.size });
    if (!result.ok) {
      dispatch({ type: 'error', message: result.message });
      return;
    }
    setFile(nextFile);
    setSelectedBackground(TRANSPARENT_BACKGROUND);
    setShowOriginal(false);
    setResultError(null);
    automaticResultRefreshAttemptedRef.current = false;
    dispatch({ type: 'select', previewUrl: URL.createObjectURL(nextFile), fileName: nextFile.name });
  }, []);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      const image = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();
      if (image) {
        event.preventDefault();
        selectFile(image);
      }
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [selectFile]);

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) selectFile(nextFile);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) selectFile(nextFile);
  }

  const uploadAndProcess = useCallback(async () => {
    if (!file) return;
    try {
      dispatch({ type: 'upload' });
      const signed = await api<{ url: string; key: string }>('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      const upload = await putFileWithRetry(signed.url, file, file.type);
      if (!upload.ok) throw new Error('The image could not be uploaded. Please try again.');

      const created = await api<{ id: string; status: string }>('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputKey: signed.key, operation: 'background-removal' }),
      });
      window.dispatchEvent(new Event('benefits:changed'));
      dispatch({ type: 'process', jobId: created.id });

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const job = await api<CompletedJobLinks>(`/api/jobs/${created.id}`);
        if (job.status === 'completed' && job.resultUrl && job.downloadUrl) {
          setSelectedBackground(TRANSPARENT_BACKGROUND);
          setShowOriginal(false);
          automaticResultRefreshAttemptedRef.current = false;
          dispatch({ type: 'complete', resultUrl: job.resultUrl, downloadUrl: job.downloadUrl });
          return;
        }
        if (job.status === 'failed') throw new Error(job.error ?? 'Background removal failed.');
        await wait(1000);
      }
      throw new Error('Processing took too long. Please try again.');
    } catch (error) {
      window.dispatchEvent(new Event('benefits:changed'));
      dispatch({ type: 'error', message: userFacingError(error, 'The image service could not be reached. Please check your connection and try again.') });
    }
  }, [file]);

  const refreshResultLinks = useCallback(async () => {
    if (!state.jobId) throw new Error('This result can no longer be refreshed. Please process the image again.');
    setRefreshingResult(true);
    try {
      const job = await api<CompletedJobLinks>(`/api/jobs/${state.jobId}`);
      if (job.status !== 'completed' || !job.resultUrl || !job.downloadUrl) {
        throw new Error(job.error ?? 'The result is not available yet. Please try again.');
      }
      dispatch({ type: 'complete', resultUrl: job.resultUrl, downloadUrl: job.downloadUrl });
      setResultError(null);
      return { resultUrl: job.resultUrl, downloadUrl: job.downloadUrl };
    } finally {
      setRefreshingResult(false);
    }
  }, [state.jobId]);

  function handleResultImageError() {
    if (showOriginal || refreshingResult || !state.jobId) return;
    setShowOriginal(true);
    if (automaticResultRefreshAttemptedRef.current) {
      setResultError('The result image could not be loaded. Please check your connection and try downloading it again.');
      return;
    }
    automaticResultRefreshAttemptedRef.current = true;
    void refreshResultLinks()
      .then(() => setShowOriginal(false))
      .catch((error) => setResultError(userFacingError(error, 'The result link expired and could not be refreshed. Please try again.')));
  }

  useEffect(() => {
    let completing = false;
    async function completeAuth(data: unknown) {
      if (completing || (data as { type?: string } | null)?.type !== 'clearmark-auth-complete') return;
      completing = true;
      const refreshed = await authClient.getSession();
      if (!refreshed.data?.user) {
        completing = false;
        setLoginPending(false);
        dispatch({ type: 'error', message: 'Google sign-in could not be confirmed. Please try again.' });
        return;
      }
      await refetchSession();
      setShowLogin(false);
      setLoginPending(false);
      await uploadAndProcess();
    }
    function handleWindowMessage(event: MessageEvent) {
      if (event.origin === window.location.origin) void completeAuth(event.data);
    }
    function handleAuthComplete(event: MessageEvent) {
      void completeAuth(event.data);
    }
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clearmark-auth');
    channel?.addEventListener('message', handleAuthComplete);
    window.addEventListener('message', handleWindowMessage);
    return () => {
      channel?.removeEventListener('message', handleAuthComplete);
      channel?.close();
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [refetchSession, uploadAndProcess]);

  function start() {
    if (!file || sessionPending) return;
    if (!session?.user) {
      setShowLogin(true);
      return;
    }
    void uploadAndProcess();
  }

  async function continueWithGoogle() {
    const popup = window.open('about:blank', 'clearmark-google-auth', 'popup=yes,width=520,height=680,left=240,top=80');
    if (!popup) {
      dispatch({ type: 'error', message: 'Please allow popups for this site, then try Google sign-in again.' });
      setShowLogin(false);
      return;
    }
    setLoginPending(true);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: `${window.location.origin}/auth/popup`,
      disableRedirect: true,
    });
    if (result.error || !result.data?.url) {
      popup.close();
      setLoginPending(false);
      dispatch({ type: 'error', message: 'Unable to start Google sign-in. Please try again.' });
      return;
    }
    popup.location.href = result.data.url;
  }

  function reset() {
    setFile(null);
    setSelectedBackground(TRANSPARENT_BACKGROUND);
    setShowOriginal(false);
    setResultError(null);
    automaticResultRefreshAttemptedRef.current = false;
    if (inputRef.current) inputRef.current.value = '';
    dispatch({ type: 'reset' });
  }

  async function downloadResult() {
    if (!state.jobId) return;
    try {
      setDownloadPending(true);
      const links = await refreshResultLinks();
      if (selectedBackground.color) {
        await downloadWithBackground(links.resultUrl, selectedBackground.color);
      } else {
        const anchor = document.createElement('a');
        anchor.href = links.downloadUrl;
        anchor.download = 'background-removed-image.png';
        anchor.click();
      }
    } catch (error) {
      setResultError(userFacingError(error, 'The result could not be downloaded. Please check your connection and try again.'));
    } finally {
      setDownloadPending(false);
    }
  }

  const busy = state.phase === 'uploading' || state.phase === 'processing';

  return (
    <section ref={toolRef} className="tool-card background-tool-card" aria-labelledby="background-upload-title">
      <div className="tool-heading">
        <div><span className="eyebrow">{copy.hero.eyebrow}</span><h2 id="background-upload-title">{copy.hero.heading}</h2></div>
        <span className="demo-badge" title={copy.hero.demoBadgeTitle}>{copy.hero.demoBadge}</span>
      </div>

      {state.previewUrl ? null : (
        <label
          className={`drop-zone background-drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="upload-action"><CloudUpload size={20} strokeWidth={2.4} aria-hidden="true" /><strong>{copy.dropzone.dropLabel}</strong></span>
          <span>{copy.dropzone.browseLabel} or paste an image (Ctrl+V)</span>
          <small>{copy.dropzone.formatLabel} · {formatCopy(copy.dropzone.maxSizeLabel, { maxSize: String(MAX_UPLOAD_BYTES / 1024 / 1024) })}</small>
          <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,.jfif" aria-label={copy.dropzone.fileInputLabel} onChange={onInput} />
        </label>
      )}

      {state.message ? <p className="error-message" role="alert">{state.message}</p> : null}

      {state.previewUrl && state.phase !== 'completed' ? (
        <div className="preview-panel">
          <img src={state.previewUrl} alt={formatCopy(copy.preview.altTemplate, { fileName: state.fileName ?? '' })} />
          <div className="preview-meta">
            <div><strong>{state.fileName}</strong><span>{busy ? copy.preview.processingLabel : copy.preview.readyLabel}</span></div>
            <button className="button button-primary" type="button" onClick={start} disabled={busy}>
              {state.phase === 'uploading' ? copy.preview.uploadingButton : state.phase === 'processing' ? copy.preview.processingButton : copy.preview.removeButton}
            </button>
            {!busy ? <button className="button button-ghost" type="button" onClick={reset}>{copy.preview.chooseAnotherButton}</button> : null}
          </div>
          {busy ? <div className="progress-track" aria-label="Processing"><span /></div> : null}
        </div>
      ) : null}

      {state.phase === 'completed' && state.previewUrl && state.resultUrl && state.downloadUrl ? (
        <div className="background-result">
          <div className="background-result-layout">
            <div
              className={`background-result-stage ${!showOriginal && selectedBackground.color === null ? 'is-transparent' : ''}`}
              style={!showOriginal && selectedBackground.color ? { backgroundColor: selectedBackground.color } : undefined}
            >
              <img src={showOriginal ? state.previewUrl : state.resultUrl} alt={showOriginal ? copy.result.originalAlt : copy.result.resultAlt} onError={handleResultImageError} />
              <button className="background-reset" type="button" onClick={reset} aria-label="Remove image and start over"><Trash2 size={18} /></button>
              <button className="background-compare" type="button" onClick={() => setShowOriginal((value) => !value)} aria-label={showOriginal ? 'Show background-removed result' : 'Show original image'}>
                <Columns2 size={19} /><span>{showOriginal ? 'Result' : 'Before'}</span>
              </button>
            </div>
            <aside className="background-color-panel" aria-labelledby="background-color-heading">
              <div className="background-color-heading"><Palette size={20} aria-hidden="true" /><h3 id="background-color-heading">Change background color</h3></div>
              <label className="custom-color-control">
                <span>Custom color</span>
                <input
                  type="color"
                  value={customColor}
                  aria-label="Custom background color"
                  onChange={(event) => {
                    setCustomColor(event.target.value);
                    setSelectedBackground({ id: 'custom', label: 'Custom background', color: event.target.value });
                  }}
                />
              </label>
              <div className="preset-color-group">
                <span>Preset colors</span>
                <div className="background-swatches">
                  {PRESET_BACKGROUNDS.map((background) => (
                    <button
                      key={background.id}
                      className={`background-swatch ${background.color === null ? 'is-transparent' : ''} ${selectedBackground.id === background.id ? 'is-selected' : ''}`}
                      style={background.color ? { backgroundColor: background.color } : undefined}
                      type="button"
                      aria-label={background.label}
                      aria-pressed={selectedBackground.id === background.id}
                      onClick={() => setSelectedBackground(background)}
                    />
                  ))}
                </div>
              </div>
            </aside>
          </div>
          {resultError ? <p className="error-message" role="alert">{resultError}</p> : null}
          <div className="background-result-actions">
            <button className="button button-primary" type="button" onClick={downloadResult} disabled={downloadPending || refreshingResult}>
              <Download size={17} />{downloadPending || refreshingResult ? 'Preparing…' : 'Download PNG'}
            </button>
            <button className="button button-ghost" type="button" onClick={reset}>{copy.result.processAnotherButton}</button>
          </div>
        </div>
      ) : null}

      {showLogin ? (
        <div className="auth-modal-backdrop">
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="background-auth-title">
            <button className="auth-modal-close" type="button" onClick={() => setShowLogin(false)} aria-label={copy.auth.closeLabel}>×</button>
            <img className="brand-logo auth-logo" src={logo} alt={`${siteName} logo`} />
            <h3 id="background-auth-title">{copy.auth.title}</h3>
            <p>{copy.auth.description}</p>
            <button className="button button-primary auth-google-button" type="button" onClick={continueWithGoogle} disabled={loginPending}>
              <span className="google-mark">G</span>{loginPending ? copy.auth.connectingButton : copy.auth.continueButton}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setShowLogin(false)}>{copy.auth.dismissButton}</button>
          </section>
        </div>
      ) : null}

      <p className="privacy-note"><LockKeyhole size={14} strokeWidth={2.2} aria-hidden="true" /> {copy.privacyNote}</p>
    </section>
  );
}
