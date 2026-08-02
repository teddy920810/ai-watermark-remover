import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const configSource = readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8');
const config = YAML.parse(configSource) as {
  settings: { content: { merge: boolean }; commit: { identity: string } };
  content: Array<{ name: string; operations: { create: boolean; rename: boolean; delete: boolean } }>;
};

describe('Pages CMS maintenance safeguards', () => {
  it('preserves unmanaged fields and uses the GitHub app identity', () => {
    expect(config.settings.content.merge).toBe(true);
    expect(config.settings.commit.identity).toBe('app');
  });

  it('prevents non-technical editors from renaming or deleting entries', () => {
    expect(config.content).toHaveLength(2);
    for (const collection of config.content) {
      expect(collection.operations).toEqual({ create: true, rename: false, delete: false });
    }
  });
});
