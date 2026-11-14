import { readFileSync } from 'node:fs';
import { transform } from '@astrojs/compiler';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./SiteLayout.astro', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const snippet = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5361898162179630"\n     crossorigin="anonymous"></script>';

describe('AdSense installation contract', () => {
  it('preserves the supplied asynchronous anonymous script in the public page head', async () => {
    // https://support.google.com/adsense/answer/9274516
    const head = source.split('<head>')[1]?.split('</head>')[0];
    expect(head).toContain(snippet);
    expect(source.match(/adsbygoogle\.js/g)).toHaveLength(1);
    expect(source).not.toContain('ca-pub-9528426824533226');
    const compiled = await transform(source, { filename: 'SiteLayout.astro' });
    // Astro must leave this vendor script in HTML, rather than bundling it.
    expect(compiled.scripts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ src: expect.stringContaining('adsbygoogle.js') }),
    ]));
    expect(compiled.code).toContain('adsbygoogle.js?client=ca-pub-5361898162179630');
  });
});
