import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blogIndexSettingsSchema,
  landingCommonSettingsSchema,
  notFoundSettingsSchema,
} from './marketing-settings';

function readJson(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

describe('marketing page CMS settings', () => {
  it('validates the blog listing settings', () => {
    const parsed = blogIndexSettingsSchema.parse(readJson('../../content/settings/blog.json'));
    expect(parsed.postsPerPage).toBeGreaterThan(0);
  });

  it('validates reusable landing-page sections', () => {
    const parsed = landingCommonSettingsSchema.parse(readJson('../../content/settings/landing.json'));
    expect(parsed.process.steps.length).toBeGreaterThan(0);
  });

  it('validates the 404 page settings', () => {
    const parsed = notFoundSettingsSchema.parse(readJson('../../content/settings/not-found.json'));
    expect(parsed.heading).toMatch(/\S/);
  });
});
