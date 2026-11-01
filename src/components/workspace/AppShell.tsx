import { useState, type ReactNode } from 'react';
import { Image as ImageIcon, Menu, Video, X } from 'lucide-react';
import type { ProductOperation } from '../../lib/contracts/operation-catalog';
import type { MediaKind } from '../../lib/client/media-drafts';
import { appOperationPath, operationLabels } from './app-entry';

interface Props {
  kind: MediaKind; logo: string; siteName: string; account: ReactNode; sidebar: ReactNode; children: ReactNode;
  operation: ProductOperation; locked?: boolean; canRefine?: boolean; disabledOperations?: ProductOperation[]; onOperation?(operation: ProductOperation): void; onFileDrop?(file: File): void;
}
export function AppShell({ kind, logo, siteName, account, sidebar, children, operation, locked = false, canRefine = false, disabledOperations = [], onOperation, onFileDrop }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const operations = (Object.keys(operationLabels) as ProductOperation[]).filter(value => (value === 'video-watermark') === (kind === 'video'));
  return <div className="watermark-workspace" data-app-shell>
    <header className="site-header workspace-header">
      <a className="brand" href="/"><img className="brand-logo" src={logo} alt="" /><span>{siteName}</span></a>
      <nav className="workspace-mode-nav" aria-label="Media workspace"><a href="/app/image" aria-current={kind === 'image' ? 'page' : undefined}><ImageIcon size={18} />Image</a><a href="/app/video" aria-current={kind === 'video' ? 'page' : undefined}><Video size={18} />Video</a></nav>
      <div className="workspace-header-actions">{account}<button className="workspace-menu-button" aria-label="Open menu" aria-expanded={menuOpen} type="button" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button></div>
      {menuOpen && <nav className="workspace-menu"><a href="/">Back to website</a><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>}
    </header>
    <div className="workspace-layout">
      <aside className="workspace-recent">{sidebar}</aside>
      <main className="workspace-main" onDragOver={event => { if (onFileDrop && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => {
        if (!onFileDrop || !event.dataTransfer.files.length) return;
        event.preventDefault(); if (!locked) onFileDrop(event.dataTransfer.files[0]);
      }}>
        <label className="workspace-operation-choice">Operation<select aria-label="Choose operation" value={operation} disabled={locked} onChange={event => {
          const next = event.target.value as ProductOperation;
          if (onOperation) onOperation(next); else window.location.assign(appOperationPath(next));
        }}>{operations.map(value => <option key={value} value={value} disabled={value === 'image-refine' && !canRefine || disabledOperations.includes(value)}>{operationLabels[value]}</option>)}</select></label>
        {children}
      </main>
    </div>
  </div>;
}
