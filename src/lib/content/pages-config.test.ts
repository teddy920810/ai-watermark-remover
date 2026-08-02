import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const configSource = readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8');

describe('Pages CMS maintenance safeguards', () => {
  it('preserves unmanaged fields and uses the GitHub app identity', () => {
    expect(configSource).toContain('merge: true');
    expect(configSource).toContain('identity: app');
  });

  it('prevents non-technical editors from renaming or deleting entries', () => {
    expect(configSource.match(/rename: false/g)).toHaveLength(2);
    expect(configSource.match(/delete: false/g)).toHaveLength(2);
  });
});
