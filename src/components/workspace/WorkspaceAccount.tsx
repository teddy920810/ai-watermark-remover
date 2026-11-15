import { useEffect, useState } from 'react';
import { Coins, LogOut, UserRound } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { listenForAuthCompletion } from '../../lib/client/auth-completion';
import { clearMediaDrafts } from '../../lib/client/media-drafts';
import { displayError, workspaceApi, type PublicBalances } from './workspace-api';
interface Props {
  user?: { id?: string; image?: string | null } | null;
  pending?: boolean;
  balances?: PublicBalances | null;
  signIn?(): void | Promise<void>;
  signOut?(): void | Promise<void>;
}
export function WorkspaceAccount(props: Props = {}) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const user = props.user === undefined ? session?.user : props.user;
  const pending = props.pending ?? isPending;
  const [balances, setBalances] = useState<{ owner: string | undefined; value: PublicBalances } | null>(null);
  const [error, setError] = useState(''); const [open, setOpen] = useState(false);
  const balance = props.balances === undefined ? balances?.owner === user?.id ? balances?.value ?? null : null : props.balances;
  useEffect(() => {
    setBalances(null); if (!user || props.balances !== undefined) return;
    let active = true;
    void workspaceApi<PublicBalances>('/me').then(value => { if (active) setBalances({ owner: user.id, value }); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id, props.balances]);
  async function signIn() {
    if (props.signIn) { await props.signIn(); return; }
    setError('');
    const popup = window.open('about:blank', 'clearmark-google-auth', 'popup=yes,width=520,height=680');
    if (!popup) { setError('Allow the Google sign-in window to keep your work on this page.'); return; }
    try {
      // Preserve the existing popup flow; https://better-auth.com/docs/authentication/google
      const response = await authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}/auth/popup`, disableRedirect: true });
      if (response.error || !response.data?.url) throw new Error('Unable to start Google sign-in. Please try again.');
      popup.location.href = response.data.url;
    } catch (cause) { popup.close(); setError(displayError(cause)); }
  }
  async function signOut() {
    if (props.signOut) { await props.signOut(); return; }
    await clearMediaDrafts().catch(() => {});
    for (const kind of ['image', 'video']) { sessionStorage.removeItem(`watermarkgemini:upload:${kind}`); sessionStorage.removeItem(`watermarkgemini:confirmation:${kind}`); }
    await authClient.signOut(); window.location.replace('/app');
  }
  useEffect(() => {
    const listener = () => { void signIn(); };
    window.addEventListener('workspace:sign-in', listener); return () => window.removeEventListener('workspace:sign-in', listener);
  });
  useEffect(() => {
    if (props.signIn) return;
    return listenForAuthCompletion({ target: window, channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clearmark-auth'), once: false, confirm: async () => Boolean((await authClient.getSession()).data?.user), onConfirmed: async () => { await refetch(); }, onRejected: () => setError('Google sign-in could not be confirmed. Please try again.') });
  }, [props.signIn, refetch]);
  return <div className="unified-account">
    {user ? <>{balance && <a className="unified-balance" href="/app/credits"><Coins size={17} /><span>{balance.walletMode === 'unified' ? `${balance.credits} Credits` : `${balance.freeUses} Free Image Uses`}</span></a>}<div className="unified-account-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.querySelector('button')?.focus(); } }}><button className="workspace-account" aria-label="Account menu" aria-expanded={open} type="button" onClick={() => setOpen(value => !value)}><UserRound size={22} aria-hidden="true" /></button>{open && <div className="unified-account-panel"><a href="/app/credits">Credits &amp; Orders</a><button type="button" onClick={() => void signOut()}><LogOut size={16} />Sign out</button></div>}</div></> : <button type="button" className="header-cta" disabled={pending} onClick={() => void signIn()}>Sign in with Google</button>}
    {error && <p className="unified-account-error" role="alert">{error}<button type="button" onClick={() => setError('')}>Dismiss</button></p>}
  </div>;
}
