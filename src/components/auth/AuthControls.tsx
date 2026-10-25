import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountPanelId = useId();

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
      setAccountOpen(false);
      return;
    }
    void loadBenefits();
    const handleChange = () => void loadBenefits();
    window.addEventListener('benefits:changed', handleChange);
    return () => window.removeEventListener('benefits:changed', handleChange);
  }, [loadBenefits, session?.user]);

  useEffect(() => {
    if (!accountOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [accountOpen]);

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
          <span title={benefitError ? 'Balance unavailable — open your account to retry' : 'Free image uses'}>
            <span className="header-benefit-label">Free uses </span>
            <strong>{benefitError ? '—' : benefits ? `${benefits.balance}/${benefits.cap}` : '…'}</strong>
            {benefitError && <span className="sr-only">Balance unavailable</span>}
          </span>
          {!benefitError ? (
            <button
              className="header-check-in"
              type="button"
              onClick={checkIn}
              disabled={benefitPending || !benefits || benefits.checkedInToday || balanceFull}
            >
              {benefitPending ? 'Updating…' : checkInLabel}
            </button>
          ) : <button className="header-check-in" type="button" onClick={loadBenefits} disabled={benefitPending}>Retry</button>}
        </section>
        <div
          className="header-account-menu"
          ref={accountMenuRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !accountOpen) return;
            event.preventDefault();
            event.stopPropagation();
            setAccountOpen(false);
            accountButtonRef.current?.focus();
          }}
        >
          <button
            className="header-account"
            ref={accountButtonRef}
            type="button"
            aria-label="Account menu"
            aria-haspopup="dialog"
            aria-controls={accountPanelId}
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
          >
            {session.user.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer" /> : <UserRound size={22} aria-hidden="true" />}
            <ChevronDown className="account-chevron" size={13} aria-hidden="true" />
          </button>
          <div id={accountPanelId} className="header-account-panel" role="dialog" aria-label="Account menu" hidden={!accountOpen}>
            <p className="account-name">{session.user.name}</p>
            <p className="account-balance" role="status">
              {benefitError ? 'Balance unavailable. Please try again.' : benefits ? `Free uses ${benefits.balance}/${benefits.cap}` : 'Loading balance…'}
            </p>
            <a href="/app/image">Open workspace</a>
            {benefitError ? <button type="button" onClick={loadBenefits} disabled={benefitPending}>{benefitPending ? 'Updating…' : 'Retry'}</button> : (
              <button className="account-menu-check-in" type="button" onClick={checkIn} disabled={benefitPending || !benefits || benefits.checkedInToday || balanceFull}>
                {benefitPending ? 'Updating…' : checkInLabel}
              </button>
            )}
            <button className="account-sign-out" type="button" onClick={signOut} disabled={actionPending}>
              <LogOut size={16} aria-hidden="true" />{actionPending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button className="header-cta" type="button" onClick={signIn} disabled={isPending || actionPending}>
      {actionPending ? 'Connecting…' : 'Sign in with Google'}
    </button>
  );
}
