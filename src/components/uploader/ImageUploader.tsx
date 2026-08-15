import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { authClient } from '../auth/auth-client';
import { putFileWithRetry } from '../../lib/upload/direct-upload';
import { MAX_UPLOAD_BYTES, validateUploadMetadata } from '../../lib/upload/validation';
import { initialUploadState, uploadReducer } from './upload-machine';
import type { UploaderCopy } from '../../lib/content/site-settings';

type JsonRecord = Record<string, unknown>;

interface Props {
  logo: string;
  siteName: string;
  copy: UploaderCopy;
}

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

export default function ImageUploader({ logo, siteName, copy }: Props) {
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    };
  }, [state.previewUrl]);

  function selectFile(nextFile: File) {
    const result = validateUploadMetadata({ contentType: nextFile.type, size: nextFile.size });
    if (!result.ok) {
      dispatch({ type: 'error', message: result.message });
      return;
    }
    setFile(nextFile);
    dispatch({ type: 'select', previewUrl: URL.createObjectURL(nextFile), fileName: nextFile.name });
  }

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
        body: JSON.stringify({ inputKey: signed.key }),
      });
      dispatch({ type: 'process', jobId: created.id });

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const job = await api<{ status: string; resultUrl?: string; downloadUrl?: string; error?: string }>(`/api/jobs/${created.id}`);
        if (job.status === 'completed' && job.resultUrl && job.downloadUrl) {
          dispatch({ type: 'complete', resultUrl: job.resultUrl, downloadUrl: job.downloadUrl });
          return;
        }
        if (job.status === 'failed') throw new Error(job.error ?? 'Image processing failed.');
        await wait(1000);
      }
      throw new Error('Processing took too long. Please try again.');
    } catch (error) {
      dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
  }, [file]);

  useEffect(() => {
    async function handleAuthComplete(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'clearmark-auth-complete') return;
      const refreshed = await authClient.getSession();
      if (!refreshed.data?.user) {
        dispatch({ type: 'error', message: 'Google sign-in could not be confirmed. Please try again.' });
        return;
      }
      await refetchSession();
      setShowLogin(false);
      setLoginPending(false);
      await uploadAndProcess();
    }

    window.addEventListener('message', handleAuthComplete);
    return () => window.removeEventListener('message', handleAuthComplete);
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
    const popup = window.open(
      'about:blank',
      'clearmark-google-auth',
      'popup=yes,width=520,height=680,left=240,top=80',
    );
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
    if (inputRef.current) inputRef.current.value = '';
    dispatch({ type: 'reset' });
  }

  const busy = state.phase === 'uploading' || state.phase === 'processing';

  return (
    <section className="tool-card" aria-labelledby="upload-title">
      <div className="tool-heading">
        <div>
          <span className="eyebrow">{copy.hero.eyebrow}</span>
          <h2 id="upload-title">{copy.hero.heading}</h2>
        </div>
        <span className="demo-badge" title={copy.hero.demoBadgeTitle}>{copy.hero.demoBadge}</span>
      </div>

      {state.phase === 'idle' || state.phase === 'error' ? (
        <label
          className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="upload-icon" aria-hidden="true">↑</span>
          <strong>{copy.dropzone.dropLabel}</strong>
          <span>{copy.dropzone.browseLabel}</span>
          <small>{copy.dropzone.formatLabel} · {formatCopy(copy.dropzone.maxSizeLabel, { maxSize: String(MAX_UPLOAD_BYTES / 1024 / 1024) })}</small>
          <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label={copy.dropzone.fileInputLabel} onChange={onInput} />
        </label>
      ) : null}

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
        <div className="result-panel">
          <div className="comparison-grid">
            <figure><figcaption>{copy.result.originalLabel}</figcaption><img src={state.previewUrl} alt={copy.result.originalAlt} /></figure>
            <figure><figcaption>{copy.result.resultLabel}</figcaption><img src={state.resultUrl} alt={copy.result.resultAlt} /></figure>
          </div>
          <p className="demo-note">{copy.result.demoNote}</p>
          <div className="result-actions">
            <a className="button button-primary" href={state.downloadUrl}>{copy.result.downloadButton}</a>
            <button className="button button-ghost" type="button" onClick={reset}>{copy.result.processAnotherButton}</button>
          </div>
        </div>
      ) : null}

      {showLogin ? (
        <div className="auth-modal-backdrop">
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
            <button className="auth-modal-close" type="button" onClick={() => setShowLogin(false)} aria-label={copy.auth.closeLabel}>×</button>
            <img className="brand-logo auth-logo" src={logo} alt={`${siteName} logo`} />
            <h3 id="auth-modal-title">{copy.auth.title}</h3>
            <p>{copy.auth.description}</p>
            <button className="button button-primary auth-google-button" type="button" onClick={continueWithGoogle} disabled={loginPending}>
              <span className="google-mark">G</span>
              {loginPending ? copy.auth.connectingButton : copy.auth.continueButton}
            </button>
            <button className="button button-ghost" type="button" onClick={() => setShowLogin(false)}>{copy.auth.dismissButton}</button>
          </section>
        </div>
      ) : null}

      <p className="privacy-note"><span aria-hidden="true">◇</span> {copy.privacyNote}</p>
    </section>
  );
}
