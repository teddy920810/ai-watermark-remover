import { createElement } from 'react';
import type { UploaderCopy } from '../../lib/content/site-settings';
import type { MediaKind } from '../../lib/client/media-drafts';
export function launcherCopy(kind: MediaKind, copy?: UploaderCopy) {
  return {
    dropLabel: copy?.dropzone.dropLabel ?? (kind === 'video' ? 'Drop an MP4 here' : 'Drop your image here'),
    browseLabel: copy?.dropzone.browseLabel ?? 'or click to browse',
    fileInputLabel: copy?.dropzone.fileInputLabel ?? `Choose ${kind} for watermark removal`,
  };
}
export function LauncherPrompt({ kind, copy }: { kind: MediaKind; copy?: UploaderCopy }) {
  const labels = launcherCopy(kind, copy);
  return createElement('p', { className: 'launcher-drop-copy' }, createElement('strong', null, labels.dropLabel), createElement('span', null, ` ${labels.browseLabel}`));
}
