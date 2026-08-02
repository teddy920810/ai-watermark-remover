import { describe, expect, it } from 'vitest';
import { initialUploadState, uploadReducer } from './upload-machine';

describe('upload state machine', () => {
  it('moves from idle to ready after file selection', () => {
    const state = uploadReducer(initialUploadState, { type: 'select', previewUrl: 'blob:preview', fileName: 'photo.png' });
    expect(state).toMatchObject({ phase: 'ready', previewUrl: 'blob:preview', fileName: 'photo.png' });
  });

  it('tracks uploading and processing phases', () => {
    const ready = uploadReducer(initialUploadState, { type: 'select', previewUrl: 'blob:preview', fileName: 'photo.png' });
    const uploading = uploadReducer(ready, { type: 'upload' });
    expect(uploading.phase).toBe('uploading');
    expect(uploadReducer(uploading, { type: 'process', jobId: 'job-1' })).toMatchObject({ phase: 'processing', jobId: 'job-1' });
  });

  it('stores completed result links', () => {
    const completed = uploadReducer(initialUploadState, { type: 'complete', resultUrl: 'https://result', downloadUrl: 'https://download' });
    expect(completed).toMatchObject({ phase: 'completed', resultUrl: 'https://result', downloadUrl: 'https://download' });
  });

  it('can recover from an error by selecting another file', () => {
    const failed = uploadReducer(initialUploadState, { type: 'error', message: 'Upload failed' });
    expect(uploadReducer(failed, { type: 'select', previewUrl: 'blob:new', fileName: 'new.webp' }).phase).toBe('ready');
  });
});
