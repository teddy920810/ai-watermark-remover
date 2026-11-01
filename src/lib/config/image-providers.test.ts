import { describe, expect, it } from 'vitest';
import { readImageProviderConfig } from './image-providers';

describe('shared Web/Worker image Provider configuration', () => {
  it('preserves model versions, timeouts and token-selected defaults without enabling admissions', () => {
    expect(readImageProviderConfig({})).toMatchObject({ BACKGROUND_REMOVAL_PROVIDER: 'mock', OBJECT_REMOVAL_PROVIDER: 'mock', REPLICATE_BASE_URL: 'https://api.replicate.com', REPLICATE_TIMEOUT_MS: 45_000, REPLICATE_WAIT_SECONDS: 20, REPLICATE_BACKGROUND_MODEL_VERSION: 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc', REPLICATE_LAMA_MODEL_VERSION: 'cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72' });
    expect(readImageProviderConfig({ REPLICATE_API_TOKEN: 'fixture' })).toMatchObject({ BACKGROUND_REMOVAL_PROVIDER: 'replicate', OBJECT_REMOVAL_PROVIDER: 'replicate' });
    expect(readImageProviderConfig({ REPLICATE_API_TOKEN: 'fixture', BACKGROUND_REMOVAL_PROVIDER: 'mock' }).BACKGROUND_REMOVAL_PROVIDER).toBe('mock');
    expect(readImageProviderConfig({})).not.toHaveProperty('PROCESSING_ENABLED');
  });
  it('requires a token for explicit Replicate selection and rejects invalid model/wait settings', () => {
    expect(() => readImageProviderConfig({ BACKGROUND_REMOVAL_PROVIDER: 'replicate' })).toThrow();
    expect(() => readImageProviderConfig({ OBJECT_REMOVAL_PROVIDER: 'replicate' })).toThrow();
    expect(() => readImageProviderConfig({ REPLICATE_WAIT_SECONDS: '61' })).toThrow();
    expect(() => readImageProviderConfig({ REPLICATE_BACKGROUND_MODEL_VERSION: 'unapproved' })).toThrow();
  });
});
