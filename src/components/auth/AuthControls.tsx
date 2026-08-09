import { useState } from 'react';
import { authClient } from './auth-client';

export default function AuthControls() {
  const { data: session, isPending } = authClient.useSession();
  const [actionPending, setActionPending] = useState(false);

  async function signIn() {
    setActionPending(true);
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });
    } finally {
      setActionPending(false);
    }
  }

  async function signOut() {
    setActionPending(true);
    try {
      await authClient.signOut();
      window.location.reload();
    } finally {
      setActionPending(false);
    }
  }

  if (session?.user) {
    return (
      <button className="header-account" type="button" onClick={signOut} disabled={actionPending} title="Sign out">
        {session.user.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer" /> : null}
        <span>{session.user.name}</span>
        <small>{actionPending ? 'Signing out…' : 'Sign out'}</small>
      </button>
    );
  }

  return (
    <button className="header-cta" type="button" onClick={signIn} disabled={isPending || actionPending}>
      {actionPending ? 'Connecting…' : 'Sign in with Google'}
    </button>
  );
}
