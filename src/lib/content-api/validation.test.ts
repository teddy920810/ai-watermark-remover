import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { htmlIssues, markdownIssues, parseEntry, safeLink } from './validation';
describe('Agent content syntax and executable examples', () => {
  it.each(['blog', 'landing'] as const)('accepts the complete %s documentation example and retains its content', kind => {
    const input = JSON.parse(readFileSync(`docs/examples/content-api/${kind}.json`, 'utf8'));
    const parsed = parseEntry(kind, input, input.data.slug);
    expect(parsed.body).toBe(input.body); expect(parsed.data.draft).toBe(true);
  });
  it('accepts a small HTML allowlist but rejects browser-decoded executable URLs, namespaces and attributes', () => {
    expect(htmlIssues('<h2>Safe</h2><p><a href="https://example.com/guide">Guide</a></p><img src="/uploads/example.png" alt="Example" width="40">')).toEqual([]);
    for (const html of ['<a href="&#x6a;avascript:alert(1)">x</a>', '<svg><script>x</script></svg>', '<img src="/uploads/a.png" alt="x" onerror="bad()">', '<iframe src="https://example.com"></iframe>', '<p style="background:url(javascript:bad)">x</p>', '<form action="https://example.com">x</form>']) expect(htmlIssues(html).length).toBeGreaterThan(0);
  });
  it('validates Markdown reference links and image alt without interpreting code as MDX', () => {
    expect(markdownIssues('## Guide\n\n[Safe](https://example.com)\n\n```js\nconst safe = true;\n```')).toEqual([]);
    expect(markdownIssues('[x][bad]\n\n[bad]: javascript:alert(1)').length).toBeGreaterThan(0);
    expect(markdownIssues('![][photo]\n\n[photo]: /uploads/a.png').length).toBeGreaterThan(0);
    for (const value of ['//evil.example/a', '/api/upload-url', '/uploads/../private', 'data:text/html,bad', 'https://user:password@example.com']) expect(safeLink(value)).toBe(false);
  });
  it('rejects script delimiters in metadata and nested FAQ text that is also rendered in JSON-LD', () => {
    const blog = JSON.parse(readFileSync('docs/examples/content-api/blog.json', 'utf8'));
    blog.data.title = '</script><script>alert(1)</script>';
    expect(() => parseEntry('blog', blog, blog.data.slug)).toThrow();
    const landing = JSON.parse(readFileSync('docs/examples/content-api/landing.json', 'utf8'));
    landing.data.faq.items[0].answer = '</ScRiPt><img src=x onerror=alert(1)>';
    expect(() => parseEntry('landing', landing, landing.data.slug)).toThrow();
  });
});
