import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../../content/landing-pages/', import.meta.url);

describe('tool status copy requested by the content owner', () => {
  it.each(readdirSync(directory).filter(file => file.endsWith('.json')))('removes Coming Soon from all fields in %s', file => {
    const page = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    expect(JSON.stringify(page)).not.toMatch(/coming\s+soon/i);
  });

  it('removes Coming Soon from every header navigation link', () => {
    const site = JSON.parse(readFileSync(new URL('../../content/settings/site.json', import.meta.url), 'utf8'));
    expect(JSON.stringify(site.header.navigation)).not.toMatch(/coming\s+soon/i);
  });
});
