import type { MediaDraft, MediaKind } from './media-drafts';

export interface LocalMediaInfo { kind: MediaKind; width?: number; height?: number; durationSeconds?: number; fps?: number; rotation?: number; hasAudio?: boolean }
export interface PaidCapability { enabled: boolean; acceptedTypes: string[]; maxBytes: number; requiredFps?: number; maxDurationSeconds?: number }
export function paidHandoffReason(file: Pick<File, 'type' | 'size'>, media: LocalMediaInfo, capability?: PaidCapability): string | null {
  if (!capability?.enabled) return 'Cloud processing is currently unavailable.';
  if (!capability.acceptedTypes.includes(file.type)) return 'This file format is not supported by the cloud tool.';
  if (file.size > capability.maxBytes) return 'This file exceeds the cloud tool’s size limit.';
  if (media.kind === 'video') {
    if (media.rotation) return 'The cloud tool does not support video rotation metadata.';
    if (capability.requiredFps && media.fps && Math.abs(media.fps - capability.requiredFps) > 0.001) return `The cloud tool currently requires ${capability.requiredFps} fps.`;
    if (capability.maxDurationSeconds && media.durationSeconds && media.durationSeconds > capability.maxDurationSeconds) return 'This video exceeds the cloud tool’s duration limit.';
  }
  return null;
}
export function handoffIsUsable(draft: { ownerId?: string; expiresAt: number; handoff?: boolean; kind: string; recommendation?: { operation?: string } }, ownerId?: string, now = Date.now()): boolean {
  return Boolean(ownerId && draft.ownerId === ownerId && draft.handoff === true && draft.expiresAt > now && draft.recommendation?.operation === (draft.kind === 'image' ? 'image-watermark' : draft.kind === 'video' ? 'video-watermark' : ''));
}
export function paidHandoffPath(draft: MediaDraft) { return `/app?operation=${draft.kind === 'image' ? 'image-watermark' : 'video-watermark'}&handoff=${encodeURIComponent(draft.id)}`; }
