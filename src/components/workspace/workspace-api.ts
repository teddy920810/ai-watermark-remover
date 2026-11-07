export type { Operation, MediaMetadata, Capability, PublicArtifact, PublicQuote, PublicJob, PublicUpload, PublicUploadTicket, PublicDownload, PublicBalances } from '../../lib/contracts/processing-public';
import { creditsContractVersion } from '../../lib/contracts/credits-client';
export class WorkspaceApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function workspaceApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Credits-Contract': creditsContractVersion, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new WorkspaceApiError(value.error ?? 'The service could not complete this request. Please try again.', response.status, value.code);
  return value as T;
}
export function displayError(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
