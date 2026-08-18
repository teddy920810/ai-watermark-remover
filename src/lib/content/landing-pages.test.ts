import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingPageFiles = [
  'remove-gemini-watermark.json',
  'remove-logo-from-image.json',
  'remove-text-from-image.json',
];

describe('tool landing-page usage steps', () => {
  it.each(landingPageFiles)('keeps an editable three-step process in %s', (fileName) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );

    expect(page.process).toMatchObject({
      eyebrow: expect.any(String),
      heading: expect.any(String),
      intro: expect.any(String),
    });
    expect(page.process.steps).toHaveLength(3);
    expect(page.process.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: '01', title: expect.any(String), description: expect.any(String) }),
        expect.objectContaining({ number: '02', title: expect.any(String), description: expect.any(String) }),
        expect.objectContaining({ number: '03', title: expect.any(String), description: expect.any(String) }),
      ]),
    );
  });

  it.each(landingPageFiles)('keeps an independent FAQ section in %s', (fileName) => {
    const page = JSON.parse(
      readFileSync(new URL(`../../content/landing-pages/${fileName}`, import.meta.url), 'utf8'),
    );

    expect(page.faq).toMatchObject({
      eyebrow: expect.any(String),
      heading: expect.any(String),
      intro: expect.any(String),
      items: expect.any(Array),
    });
    expect(page.faq.items.length).toBeGreaterThan(0);
  });
});
