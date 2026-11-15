import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Gift, History, Image, LayoutGrid, Link, Menu, ScanLine, Sparkles, Video, WandSparkles, Eraser, X } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { creditPolicy } from '../../lib/credits/credit-policy';
import type { ProductOperation } from '../../lib/contracts/operation-catalog';
import { workspaceTools, type WorkspaceToolId } from './workspace-tools';
import { WorkspaceAccount } from './WorkspaceAccount';

const icons = { gemini: Sparkles, link: Link, image: Image, pro: WandSparkles, background: ScanLine, object: Eraser, video: Video };
export function WorkspaceToolIcon({ icon }: { icon: keyof typeof icons }) { const Icon = icons[icon]; return <Icon size={21} aria-hidden="true" />; }
interface Props {
  logo: string; siteName: string; active: WorkspaceToolId | 'home' | 'recent'; children: ReactNode;
  account?: ReactNode; locked?: boolean;
  onOperation?(operation: ProductOperation): void;
}
export function WorkspaceShell({ logo, siteName, active, children, account, locked = false, onOperation }: Props) {
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); document.querySelector<HTMLButtonElement>('.unified-menu-toggle')?.focus(); } };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, [open]);
  const reward = creditPolicy.rewards.first;
  function signIn() { window.dispatchEvent(new Event('workspace:sign-in')); }
  return <div className="unified-workspace" data-app-shell data-operation={active}>
    <header className="unified-header workspace-header">
      <button className="unified-menu-toggle" type="button" aria-label="Open tool navigation" aria-expanded={open} aria-controls="workspace-tools" onClick={() => setOpen(value => !value)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      <a className="brand" href="/app?view=tools"><img className="brand-logo" src={logo} alt="" /><span>{siteName}</span></a>
      <div className="workspace-header-actions">{!session?.user && <span className="unified-header-gift"><Gift size={16} />{reward} Free Credits on Sign-up</span>}{account ?? <WorkspaceAccount />}</div>
    </header>
    {open && <button type="button" className="unified-nav-scrim" aria-label="Close tool navigation" onClick={() => setOpen(false)} />}
    <aside className={`unified-sidebar${open ? ' is-open' : ''}`} id="workspace-tools">
      <nav aria-label="Workspace tools" data-workspace-navigation>
        <a href="/app?view=tools" aria-current={active === 'home' ? 'page' : undefined} aria-disabled={locked || undefined} onClick={event => { if (locked) event.preventDefault(); else setOpen(false); }}><LayoutGrid size={19} />All Tools</a>
        {[true, false].map(free => <div className="unified-nav-group" key={String(free)}><p>{free ? 'Free Tools' : 'Paid Tools'}<small>{free ? 'No Credits needed' : 'Pay with Credits'}</small></p>{workspaceTools.filter(tool => tool.free === free).map(tool => {
          const disabled = locked;
          return <a key={tool.id} href={tool.href} aria-label={tool.short} data-operation={tool.id} aria-current={active === tool.id ? 'page' : undefined} aria-disabled={disabled || undefined} onClick={event => {
            if (disabled) { event.preventDefault(); return; }
            setOpen(false);
            if (onOperation && !tool.free && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onOperation(tool.id as ProductOperation); }
          }}><WorkspaceToolIcon icon={tool.icon} /><span>{tool.short}</span>{free && <small className="unified-free-label">Free</small>}</a>;
        })}</div>)}
        <a className="unified-recent-link" href="/app?view=recent" aria-current={active === 'recent' ? 'page' : undefined} aria-disabled={locked || undefined} onClick={event => { if (locked) event.preventDefault(); else setOpen(false); }}><History size={19} />Recent Tasks</a>
      </nav>
      <div className="unified-sidebar-bottom">{!session?.user ? <div className="unified-signup"><Gift size={22} /><h3>A little boost to get started</h3><p>Sign up for <strong>{reward} Free Credits</strong> to try paid tools.</p><button type="button" onClick={signIn}>Get Free Credits <ArrowRight size={16} /></button></div> : <a className="unified-credits-link" href="/app/credits">Credits &amp; Orders <ArrowRight size={16} /></a>}</div>
    </aside>
    <div className="unified-content">{children}</div>
  </div>;
}
