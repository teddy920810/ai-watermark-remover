import { useEffect, useState, type ReactNode } from 'react';
import { authClient } from '../auth/auth-client';
import { activatePaidHandoff, readPaidHandoff } from '../../lib/client/media-drafts';
import { handoffIsUsable } from '../../lib/client/free-gemini';
import { workspaceApi, type PublicJob } from './workspace-api';
import { jobIsActive } from './workspace-state';

export function PaidHandoffEntry({ id, children }: { id: string; children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [savedJob, setSavedJob] = useState('');
  useEffect(() => {
    if (isPending || !session?.user.id) return;
    let current = true;
    void (async () => {
      try {
        const draft = await readPaidHandoff(id);
        if (!current) return;
        if (!draft || !handoffIsUsable(draft, session.user.id)) throw new Error('This file handoff has expired or belongs to another account. Return to the free tool to try again.');
        const { jobs } = await workspaceApi<{ jobs: PublicJob[] }>('/jobs');
        if (!current) return;
        const pending = jobs.find(job => jobIsActive(job.status) || job.status === 'UNKNOWN');
        if (pending) { setSavedJob(`/app/${pending.operation === 'video-watermark' ? 'video' : 'image'}?job=${encodeURIComponent(pending.id)}`); throw new Error('Your saved task needs attention before another file can be imported.'); }
        activatePaidHandoff(draft);
        // From this point the existing workspace owns draft/upload/quote recovery.
        // A reload must not import the file a second time after its draft is consumed.
        const url = new URL(window.location.href);
        url.searchParams.delete('handoff');
        window.history.replaceState(window.history.state, '', url);
        setReady(true);
      } catch (cause) { if (current) setError(cause instanceof Error ? cause.message : 'This file could not be imported. Choose it again in the cloud workspace.'); }
    })();
    return () => { current = false; };
  }, [id, isPending, session?.user.id]);
  if (ready) return children;
  return <main className="workspace-loading-shell"><h1>{error ? 'File handoff paused' : 'Opening your original file'}</h1><p role="status">{error || (!session?.user ? 'Return to the free tool and sign in with the same account to continue.' : 'Checking your account and saved tasks. No processing has started.')}</p>{savedJob && <a className="button button-primary" href={savedJob}>Reopen saved task</a>}<a className="button button-ghost" href="/app/free/gemini">Back to free Gemini tool</a><a href="/app">Choose a file in the cloud workspace</a></main>;
}
