import { useCallback, useEffect, useState } from 'react';
import { authClient } from './auth-client';

interface BenefitSummary {
  balance: number;
  cap: number;
  dailyReward: number;
  checkedInToday: boolean;
  balanceFull?: boolean;
}

export default function AuthControls() {
  const { data: session, isPending } = authClient.useSession();
  const [actionPending, setActionPending] = useState(false);
  const [benefits, setBenefits] = useState<BenefitSummary | null>(null);
  const [benefitPending, setBenefitPending] = useState(false);
  const [benefitError, setBenefitError] = useState(false);

  const loadBenefits = useCallback(async () => {
    if (!session?.user) return;
    setBenefitPending(true);
    try {
      const response = await fetch('/api/me/benefits');
      if (!response.ok) throw new Error('Benefits unavailable');
      setBenefits(await response.json() as BenefitSummary);
      setBenefitError(false);
    } catch {
      setBenefitError(true);
    } finally {
      setBenefitPending(false);
    }
  }, [session?.user]);

  useEffect(() => {
    if (!session?.user) {
      setBenefits(null);
      return;
    }
    void loadBenefits();
    const handleChange = () => void loadBenefits();
    window.addEventListener('benefits:changed', handleChange);
    return () => window.removeEventListener('benefits:changed', handleChange);
  }, [loadBenefits, session?.user]);

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

  async function checkIn() {
    setBenefitPending(true);
    try {
      const response = await fetch('/api/me/check-in', { method: 'POST' });
      if (!response.ok) throw new Error('Check-in unavailable');
      setBenefits(await response.json() as BenefitSummary);
      setBenefitError(false);
    } catch {
      setBenefitError(true);
    } finally {
      setBenefitPending(false);
    }
  }

  if (session?.user) {
    const balanceFull = benefits ? benefits.balance >= benefits.cap : false;
    const checkInLabel = benefits?.checkedInToday
      ? 'Checked in today'
      : balanceFull ? 'Balance full' : 'Daily check-in +1';
    return (
      <div className="header-user-tools">
        <section className="header-benefits" aria-label="Free image uses">
          <span>{benefitError ? 'Free uses unavailable' : <>Free uses <strong>{benefits ? `${benefits.balance}/${benefits.cap}` : '…'}</strong></>}</span>
          {!benefitError ? (
            <button
              type="button"
              onClick={checkIn}
              disabled={benefitPending || !benefits || benefits.checkedInToday || balanceFull}
            >
              {benefitPending ? 'Updating…' : checkInLabel}
            </button>
          ) : <button type="button" onClick={loadBenefits} disabled={benefitPending}>Retry</button>}
        </section>
        <button className="header-account" type="button" onClick={signOut} disabled={actionPending} title="Sign out">
          {session.user.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer" /> : null}
          <span>{session.user.name}</span>
          <small>{actionPending ? 'Signing out…' : 'Sign out'}</small>
        </button>
      </div>
    );
  }

  return (
    <button className="header-cta" type="button" onClick={signIn} disabled={isPending || actionPending}>
      {actionPending ? 'Connecting…' : 'Sign in with Google'}
    </button>
  );
}
