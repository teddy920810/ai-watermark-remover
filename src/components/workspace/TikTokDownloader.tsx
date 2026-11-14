import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Link2, LoaderCircle, Video, X } from 'lucide-react';
import type { TikTokResult } from '../../lib/tiktok/resolver';
import { resolverOperationCatalog } from '../../lib/contracts/operation-catalog';
import { consumeTikTokLaunch } from '../../lib/client/tiktok-handoff';

const policy = resolverOperationCatalog['tiktok-video-resolve'];

export default function TikTokDownloader() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<TikTokResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const current = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    // Development effect replay must not consume and abort the only launch.
    queueMicrotask(() => {
      if (!active) return;
      const initial = consumeTikTokLaunch(window.location, window.history);
      if (initial) { setUrl(initial); void resolve(initial); }
    });
    return () => { active = false; current.current?.abort(); };
  }, []);

  function clear(next = '') {
    current.current?.abort(); current.current = null;
    setBusy(false); setResult(null); setError(''); setPreviewFailed(false); setUrl(next);
  }
  async function resolve(link: string) {
    if (current.current || !link.trim()) return;
    const controller = new AbortController(); current.current = controller;
    setBusy(true); setError(''); setResult(null); setPreviewFailed(false);
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs + 3000);
    try {
      const response = await fetch('/api/tools/tiktok/resolve', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'tiktok-video-resolve', url: link.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We could not resolve this video. Please try again.');
      if (!Array.isArray(data.videos) || !data.videos.length) throw new Error('No video is available for this link.');
      if (current.current === controller) setResult(data);
    } catch (failure) {
      if (current.current === controller) setError(controller.signal.aborted ? 'This request took too long. Please try again.' : failure instanceof Error ? failure.message : 'Please try again.');
    } finally {
      clearTimeout(timeout);
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }

  return <main className="tiktok-tool">
    <div className={`tiktok-layout${result ? ' has-result' : ''}`}>
      <header className="tiktok-heading"><span className="eyebrow"><Link2 size={14} aria-hidden="true" />Free video tool</span><h1>TikTok Watermark Remover for Saved Videos</h1><p>Paste a video link, preview it, and save an available MP4.</p></header>
      <div className="tiktok-content">
        <form onSubmit={event => { event.preventDefault(); void resolve(url); }} className="tiktok-form">
          <label htmlFor="tiktok-url">TikTok URL</label>
          <div className="tiktok-input-row">
            <div className="tiktok-url-field"><input ref={input} id="tiktok-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://www.tiktok.com/@user/video/…" value={url} maxLength={policy.maxUrlLength} onChange={event => clear(event.target.value)} aria-describedby="tiktok-help" aria-invalid={!!error} required />{url && <button className="tiktok-clear" type="button" aria-label="Clear TikTok URL" title="Clear TikTok URL" onClick={() => { clear(); input.current?.focus(); }}><X size={18} aria-hidden="true" /></button>}</div>
            <button className="button button-primary tiktok-primary" type="submit" disabled={busy || !url.trim()}>{busy ? <LoaderCircle aria-hidden="true" size={18} className="tiktok-spinner" /> : <Download aria-hidden="true" size={18} />}{busy ? 'Resolving…' : 'Save Video'}</button>
          </div>
          <div className="tiktok-form-foot"><p id="tiktok-help">Full video links supported. Short links are coming later.</p></div>
          {busy && <p className="tiktok-message" role="status">Finding an available video…</p>}
          {error && <p className="tiktok-error" role="alert">{error}</p>}
        </form>

        {!result && !busy && !error && <section className="tiktok-empty" aria-label="Get started"><Video size={32} aria-hidden="true" /><h2>Start with a TikTok link</h2><p>Your video preview and download options will appear here.</p></section>}

        {result && <section className="tiktok-results" aria-label="Video results">
          <article className="tiktok-card">
            <h2>Video preview</h2>
            {!previewFailed ? <video controls playsInline preload="metadata" src={result.videos[0].url} poster={result.cover ?? undefined} onError={() => setPreviewFailed(true)} aria-label="Resolved TikTok video" /> : <div className="tiktok-preview-fallback">Preview unavailable. You can still try downloading the video.</div>}
            {result.title && <p className="tiktok-video-title">{result.title}</p>}
            <p className="tiktok-ready" role="status">Ready to save</p>
          </article>
          <article className="tiktok-card tiktok-downloads">
            <div className="tiktok-card-title"><h2>Download options</h2><span>{result.videos.length} available</span></div>
            <div className="tiktok-download-list">{result.videos.map((video, index) => <a key={video.url} className="tiktok-download" href={video.url} rel="noreferrer" referrerPolicy="no-referrer" aria-label={result.videos.length === 1 ? 'Download video MP4 file' : `Download video ${index + 1} MP4 file`}><Download size={18} aria-hidden="true" /><span><strong>{result.videos.length === 1 ? 'Download video' : `Download video ${index + 1}`}</strong><small>MP4 file</small></span></a>)}</div>
            <a className="tiktok-external" href={result.videos[0].url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={18} aria-hidden="true" /><span><strong>Open in new tab</strong><small>Open the download link in your browser</small></span></a>
            <p className="tiktok-expiry">Link stopped working? Select Save Video to resolve it again.</p>
          </article>
        </section>}
        <p className="tiktok-permission">Only download videos you own or have permission to save.</p>
      </div>
    </div>
  </main>;
}
