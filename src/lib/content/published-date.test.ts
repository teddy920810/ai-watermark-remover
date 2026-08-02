import { describe, expect, it } from 'vitest';
import { publishedAtSchema } from './published-date';

describe('publishedAtSchema', () => {
  it('keeps a YYYY-MM-DD string in the canonical format', () => {
    expect(publishedAtSchema.parse('2026-08-02')).toBe('2026-08-02');
  });

  it('normalizes a YAML date object written by Pages CMS', () => {
    expect(publishedAtSchema.parse(new Date('2026-08-02T00:00:00.000Z'))).toBe('2026-08-02');
  });

  it('rejects invalid dates', () => {
    expect(() => publishedAtSchema.parse('not-a-date')).toThrow();
  });
});
