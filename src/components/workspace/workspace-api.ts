export type Operation = 'image-watermark' | 'image-watermark-pro' | 'image-refine' | 'video-watermark';
export interface MediaMetadata { kind: 'image' | 'video' | 'mask'; contentType: string; byteSize: number; width: number; height: number; durationSeconds?: number; fps?: number; hasAudio?: boolean }
export interface PublicArtifact { id: string; role: string; metadata: MediaMetadata; previewUrl?: string; expiresAt: string; canRefine?: boolean }
export interface Capability { operation: Operation; enabled: boolean; acceptedTypes: string[]; maxBytes: number; maxDurationSeconds?: number; requiredFps?: number; reason?: string }
export interface PublicQuote { id: string; amount: number; unit: 'freeUses' | 'processingCredits'; expiresAt: string; operation: Operation; expectedOutput: { contentType: string; format?: string; width?: number; height?: number; durationSeconds?: number; fps?: number; hasAudio?: boolean } }
export interface PublicJob { id: string; status: string; operation: Operation; progress?: number; error?: string; charge: { status: string; amount: number; unit: string }; input?: PublicArtifact; result?: PublicArtifact; createdAt: string; expiresAt?: string; parentJobId?: string; isDemo?: boolean }
export interface PublicUpload { id: string; status: 'created' | 'validating' | 'ready' | 'failed'; artifact?: PublicArtifact; error?: string }
export class WorkspaceApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function workspaceApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new WorkspaceApiError(value.error ?? 'The service could not complete this request. Please try again.', response.status, value.code);
  return value as T;
}
export function displayError(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
