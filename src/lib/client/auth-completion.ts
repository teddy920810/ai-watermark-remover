interface AuthCompletionOptions {
  target: Window;
  channel: BroadcastChannel | null;
  confirm: () => Promise<boolean>;
  onConfirmed: () => void | Promise<void>;
  onRejected: () => void;
  once?: boolean;
}

/** Signals only request a session check; the authenticated session remains authoritative. */
export function listenForAuthCompletion({ target, channel, confirm, onConfirmed, onRejected, once = true }: AuthCompletionOptions) {
  let disposed = false;
  let completing = false;
  let completed = false;
  async function complete(data: unknown) {
    if (disposed || completing || completed || (data as { type?: string } | null)?.type !== 'clearmark-auth-complete') return;
    completing = true;
    try {
      const authenticated = await confirm();
      if (disposed) return;
      if (!authenticated) { onRejected(); return; }
      completed = once;
      await onConfirmed();
    } catch {
      if (!disposed) onRejected();
    } finally {
      completing = false;
    }
  }
  const windowMessage = (event: MessageEvent) => { if (event.origin === target.location.origin) void complete(event.data); };
  const channelMessage = (event: MessageEvent) => { void complete(event.data); };
  target.addEventListener('message', windowMessage);
  channel?.addEventListener('message', channelMessage);
  return () => {
    disposed = true;
    target.removeEventListener('message', windowMessage);
    channel?.removeEventListener('message', channelMessage);
    channel?.close();
  };
}
