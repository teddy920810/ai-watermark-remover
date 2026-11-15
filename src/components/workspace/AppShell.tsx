import type { ReactNode } from 'react';
import type { ProductOperation } from '../../lib/contracts/operation-catalog';
import type { MediaKind } from '../../lib/client/media-drafts';
import { WorkspaceShell } from './WorkspaceShell';
interface Props {
 kind: MediaKind; logo: string; siteName: string; account: ReactNode; children: ReactNode;
 operation: ProductOperation; locked?: boolean; onOperation?(operation: ProductOperation): void; onFileDrop?(file: File): void;
}
export function AppShell({ logo, siteName, account, children, operation, locked = false, onOperation, onFileDrop }: Props) {
 return <WorkspaceShell logo={logo} siteName={siteName} active={operation === 'image-refine' ? 'image-watermark' : operation} account={account} locked={locked} onOperation={onOperation}>
  <main className="workspace-main" onDragOver={event => { if(onFileDrop && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if(!onFileDrop || !event.dataTransfer.files.length) return; event.preventDefault(); if(!locked) onFileDrop(event.dataTransfer.files[0]); }}>{children}</main>
 </WorkspaceShell>;
}
