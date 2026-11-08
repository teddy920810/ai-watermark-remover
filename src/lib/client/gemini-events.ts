type Media = 'image' | 'video' | 'unselected';
type Event = 'visit' | 'selected' | 'login' | 'start' | 'result' | 'cancelled' | 'not_detected' | 'failed' | 'download_started' | 'paid_shown' | 'paid_entry' | 'reuse';
type Payload = { media_kind: Media; run_id?: string; elapsed_ms?: number };

/** Fixed fields only: never pass a File, filename, URL or engine error to analytics. */
export function createGeminiEvents(send: (name: string, payload: Payload) => void = (name, payload) => {
  const analytics = window as Window & { gtag?: (command: string, name: string, payload: Payload) => void };
  analytics.gtag?.('event', name, payload);
}) {
  const sent = new Set<string>();
  return (event: Event, media: Media, runId?: string, elapsed?: number) => {
    if (['download_started', 'paid_entry', 'paid_shown'].includes(event) && runId) {
      const key = `${event}:${runId}`;
      if (sent.has(key)) return;
      sent.add(key);
    }
    const payload: Payload = { media_kind: media };
    if (runId) payload.run_id = runId;
    if (elapsed !== undefined && Number.isFinite(elapsed)) payload.elapsed_ms = Math.max(0, Math.round(elapsed));
    try { send(`gemini_free_${event}`, payload); } catch { /* Analytics must not interrupt a free result. */ }
  };
}
