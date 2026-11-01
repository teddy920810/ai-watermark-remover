import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { authClient } from '../auth/auth-client';
import { claimMediaDraft, clearMediaDrafts, readMediaDraft, type MediaDraft, type MediaKind } from '../../lib/client/media-drafts';
import { identityHasChanged, resolveAppEntry } from './app-entry';
import { WorkspaceLoading } from './WorkspaceLoading';

const DurableWorkspace = lazy(() => import('./WatermarkWorkspace'));
interface Props { kind: MediaKind | 'auto'; logo: string; siteName: string }
interface Entry { kind: MediaKind; draft: MediaDraft | null; requested: string | null; hasJob: boolean }

class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="workspace-loading-shell"><h1>Workspace could not open</h1><p>Reload this page to reopen your saved task or local file. No processing is started by reloading.</p><a className="button button-primary" href="">Reload workspace</a><a href="/">Back to website</a></main> : this.props.children;
  }
}
export default function AppWorkspace(props: Props) { return <WorkspaceBoundary><AppWorkspaceContent {...props} /></WorkspaceBoundary>; }

function AppWorkspaceContent({ kind, logo, siteName }: Props) {
  const { data: session, isPending } = authClient.useSession();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState('');
  const [ownerEpoch, setOwnerEpoch] = useState(0);
  const previousOwner = useRef<string | undefined>(undefined);
  const resolvedKind = useCallback((media: MediaKind) => setEntry(previous => previous && previous.kind !== media ? { ...previous, kind: media } : previous), []);
  const owner = session?.user?.id;
  const changedOwner = identityHasChanged(previousOwner.current, owner);
  useEffect(() => {
    if (isPending) return;
    // Initial anonymous sign-in must retain a mounted editor's accepted price and selection.
    if (entry && !identityHasChanged(previousOwner.current, owner)) {
      previousOwner.current = owner;
      if (owner && entry.draft) void claimMediaDraft(entry.draft, owner).catch(() => setError('Local recovery is unavailable. Keep this operation open until it finishes.'));
      return;
    }
    let active = true;
    async function open() {
      if (identityHasChanged(previousOwner.current, owner)) {
        await clearMediaDrafts().catch(() => {});
        for (const media of ['image', 'video']) {
          sessionStorage.removeItem(`watermarkgemini:upload:${media}`);
          sessionStorage.removeItem(`watermarkgemini:confirmation:${media}`);
        }
        if (!active) return;
        setEntry(null); setOwnerEpoch(value => value + 1);
      }
      previousOwner.current = owner;
      const query = new URLSearchParams(window.location.search);
      const requested = query.get('operation'); const hasJob = Boolean(query.get('job'));
      let media: MediaKind = kind === 'auto' ? requested === 'video-watermark' ? 'video' : 'image' : kind;
      let draft: MediaDraft | null = null;
      try {
        if (kind === 'auto' && !requested && !hasJob) {
          const drafts = (await Promise.all([readMediaDraft('image', owner), readMediaDraft('video', owner)])).filter((value): value is MediaDraft => Boolean(value));
          draft = drafts.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
          if (draft) media = draft.kind;
        } else draft = await readMediaDraft(media, owner);
        if (draft && owner) await claimMediaDraft(draft, owner);
      } catch { if (active) setError('Local recovery is unavailable. You can choose your file in this workspace.'); }
      if (active) setEntry({ kind: media, draft, requested, hasJob });
    }
    void open(); return () => { active = false; };
  }, [kind, owner, isPending]);
  if (!entry || !isPending && changedOwner) return <WorkspaceLoading />;
  const selection = resolveAppEntry({ kind: entry.kind, requested: entry.requested, hasJob: entry.hasJob, source: entry.draft?.source, recommendation: entry.draft?.recommendation });
  return <>
    {(error || selection.notice) && <p className="app-entry-notice" role="status">{error || selection.notice}</p>}
    <Suspense fallback={<WorkspaceLoading />}>
      <DurableWorkspace key={ownerEpoch} kind={entry.kind} logo={logo} siteName={siteName} initialMode={selection.operation === 'image-watermark-pro' ? 'pro' : 'standard'} initialOperation={selection.operation === 'background-removal' || selection.operation === 'object-removal' ? selection.operation : undefined} onResolvedKind={resolvedKind} />
    </Suspense>
  </>;
}
