import type { MediaRecommendation } from './media-recommendation';
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from '../contracts/operation-catalog';
export type MediaKind = 'image' | 'video';
export const DRAFT_TTL_MS = 60 * 60 * 1000;
const DATABASE = 'watermarkgemini-media-drafts-v1';
const STORE = 'drafts';
const pointerKey = (kind: MediaKind) => `watermarkgemini:draft:${kind}`;
export interface MediaDraft { id: string; kind: MediaKind; file: File; createdAt: number; expiresAt: number; source: string; ownerId?: string; recommendation?: MediaRecommendation; handoff?: boolean }
export function draftVisibleToOwner(draft: Pick<MediaDraft, 'ownerId'>, ownerId?: string) { return !draft.ownerId || draft.ownerId === ownerId; }
export function workspacePath(kind: MediaKind) { return `/app/${kind}`; }
export function draftIsExpired(draft: Pick<MediaDraft, 'expiresAt'>, now = Date.now()) { return !Number.isFinite(draft.expiresAt) || draft.expiresAt <= now; }
export function validateLocalMedia(file: Pick<File, 'type' | 'size' | 'name'>, kind: MediaKind, maxBytes: number = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES): { ok: true } | { ok: false; message: string } {
  const types = kind === 'image' ? ['image/jpeg', 'image/png', 'image/webp'] : ['video/mp4'];
  if (!types.includes(file.type)) return { ok: false, message: kind === 'image' ? 'Choose a JPG, PNG, or WebP image.' : 'Choose an MP4 video. Other video formats are not supported.' };
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) return { ok: false, message: `Choose a file between 1 byte and ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  return { ok: true };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Local storage is unavailable. Open the workspace and choose your file there.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(new Error('Your browser could not keep this draft. Open the workspace and choose your file there.'));
    request.onblocked = () => reject(new Error('Close other open workspace tabs and try again.'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error('Your browser could not save this file. Check available storage or choose the file in the workspace.')); };
  });
}
export async function saveMediaDraft(file: File, kind: MediaKind, source = window.location.pathname, ownerId?: string, recommendation?: MediaRecommendation): Promise<MediaDraft> {
  const validation = validateLocalMedia(file, kind);
  if (!validation.ok) throw new Error(validation.message);
  const draft: MediaDraft = { id: crypto.randomUUID(), kind, file, source, createdAt: Date.now(), expiresAt: Date.now() + DRAFT_TTL_MS, ...(ownerId ? { ownerId } : {}), ...(recommendation ? { recommendation } : {}) };
  await transact('readwrite', store => store.put(draft));
  try { sessionStorage.setItem(pointerKey(kind), draft.id); }
  catch { await deleteMediaDraft(draft.id, kind); throw new Error('Your browser blocked draft recovery. Open the workspace and choose your file there.'); }
  return draft;
}
export async function readMediaDraft(kind: MediaKind, ownerId?: string): Promise<MediaDraft | null> {
  const id = sessionStorage.getItem(pointerKey(kind));
  if (!id) return null;
  const draft = await transact<MediaDraft | undefined>('readonly', store => store.get(id));
  if (!draft || draft.kind !== kind || draftIsExpired(draft) || !draftVisibleToOwner(draft, ownerId)) { await deleteMediaDraft(id, kind); return null; }
  return draft;
}
/** Claim a known anonymous handoff without replacing its file, identifier or accepted UI state. */
export async function claimMediaDraft(draft: MediaDraft, ownerId: string): Promise<void> {
  const stored = await transact<MediaDraft | undefined>('readonly', store => store.get(draft.id));
  if (!stored) return;
  if (stored.kind !== draft.kind || draftIsExpired(stored) || !draftVisibleToOwner(stored, ownerId)) throw new Error('This local draft belongs to another account or has expired.');
  await transact('readwrite', store => store.put({ ...stored, ownerId }));
}
export async function deleteMediaDraft(id: string, kind: MediaKind): Promise<void> {
  await transact('readwrite', store => store.delete(id));
  if (sessionStorage.getItem(pointerKey(kind)) === id) sessionStorage.removeItem(pointerKey(kind));
}
export async function clearMediaDrafts(): Promise<void> {
  await transact('readwrite', store => store.clear());
  sessionStorage.removeItem(pointerKey('image')); sessionStorage.removeItem(pointerKey('video'));
}
export async function cleanExpiredMediaDrafts(): Promise<void> {
  const drafts = await transact<MediaDraft[]>('readonly', store => store.getAll());
  await Promise.all(drafts.filter(draft => draftIsExpired(draft)).map(draft => deleteMediaDraft(draft.id, draft.kind)));
}

/** Cross-tab handoff never overwrites an existing editor's draft pointer. */
export async function savePaidHandoff(file: File, kind: MediaKind, ownerId: string): Promise<MediaDraft> {
  const validation = validateLocalMedia(file, kind);
  if (!validation.ok) throw new Error(validation.message);
  const draft: MediaDraft = { id: crypto.randomUUID(), file, kind, ownerId, handoff: true, source: '/app/free/gemini', createdAt: Date.now(), expiresAt: Date.now() + DRAFT_TTL_MS, recommendation: { operation: kind === 'image' ? 'image-watermark' : 'video-watermark' } };
  await transact('readwrite', store => store.put(draft));
  return draft;
}
export async function readPaidHandoff(id: string): Promise<MediaDraft | undefined> {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('This file handoff is invalid.');
  return transact('readonly', store => store.get(id));
}
export function activatePaidHandoff(draft: MediaDraft): void {
  if (sessionStorage.getItem(`watermarkgemini:confirmation:${draft.kind}`) || sessionStorage.getItem(`watermarkgemini:upload:${draft.kind}`)) throw new Error('Reopen your saved task before importing another file.');
  sessionStorage.setItem(pointerKey(draft.kind), draft.id);
}
