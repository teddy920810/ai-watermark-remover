export type UploadPhase = 'idle' | 'ready' | 'uploading' | 'processing' | 'completed' | 'error';

export interface UploadState {
  phase: UploadPhase;
  previewUrl: string | null;
  fileName: string | null;
  jobId: string | null;
  resultUrl: string | null;
  downloadUrl: string | null;
  message: string | null;
}

export type UploadEvent =
  | { type: 'select'; previewUrl: string; fileName: string }
  | { type: 'upload' }
  | { type: 'process'; jobId: string }
  | { type: 'complete'; resultUrl: string; downloadUrl: string }
  | { type: 'error'; message: string }
  | { type: 'reset' };

export const initialUploadState: UploadState = {
  phase: 'idle',
  previewUrl: null,
  fileName: null,
  jobId: null,
  resultUrl: null,
  downloadUrl: null,
  message: null,
};

export function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case 'select':
      return { ...initialUploadState, phase: 'ready', previewUrl: event.previewUrl, fileName: event.fileName };
    case 'upload':
      return { ...state, phase: 'uploading', message: null };
    case 'process':
      return { ...state, phase: 'processing', jobId: event.jobId, message: null };
    case 'complete':
      return { ...state, phase: 'completed', resultUrl: event.resultUrl, downloadUrl: event.downloadUrl, message: null };
    case 'error':
      return { ...state, phase: 'error', message: event.message };
    case 'reset':
      return initialUploadState;
  }
}
