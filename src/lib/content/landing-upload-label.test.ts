import { expect, it } from 'vitest';
import { landingEntrySchema } from './entry-schemas';
import existingPage from '../../content/landing-pages/remove-logo-from-image.json';

it('keeps an explicitly supplied landing upload button label and rejects an empty label', () => {
  const copy = { ...existingPage, uploadButtonLabel: 'Upload Your Photo' };
  expect(landingEntrySchema.parse(copy)).toHaveProperty('uploadButtonLabel', 'Upload Your Photo');
  expect(landingEntrySchema.safeParse({ ...copy, uploadButtonLabel: '' }).success).toBe(false);
  expect(landingEntrySchema.parse(existingPage)).not.toHaveProperty('uploadButtonLabel');
});

it('preserves an optional page-specific social image without changing existing pages', () => {
  const shareImage = '/uploads/landing-new-20261114/remove-emoji-from-photo/hero-01-before.webp';
  expect(landingEntrySchema.parse({ ...existingPage, shareImage })).toHaveProperty('shareImage', shareImage);
  expect(landingEntrySchema.parse(existingPage)).not.toHaveProperty('shareImage');
});
