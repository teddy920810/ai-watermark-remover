import { describe, expect, it, vi } from 'vitest';
import { decodeTikmateResponse, extractTikmateResult } from './tikmate-response';
import { normalizeTikTokUrl, resolveTikTok } from './resolver';
import { createTikTokHandler } from './handler';

const sample = 'https://www.tiktok.com/@tester/video/7705574984709688596';
function encoded(text: string, radix = 8) {
  const alphabet = 'BbXlFzequ'.slice(0, radix + 1);
  const payload = [...Buffer.from(text)].map(byte => (byte + 45).toString(radix).replace(/\d/g, n => alphabet[Number(n)]) + alphabet[radix]).join('');
  return `<script>eval(function(h,u,n,t,e,r){throw Error('must not execute')}(${JSON.stringify(payload)},88,${JSON.stringify(alphabet)},45,${radix},3))</script>`;
}
const markup = '<h1>Sample &amp; video</h1><img src="https://p16-sign-sg.tiktokcdn.com/cover.jpg"><a href="/">New video</a><a href="https://d.rapidcdn.app/v2?token=TEST&amp;dl=1">Download</a><a href="https://evil.invalid/">Advertisement</a>';
const script = `parent.document.getElementById('download-section').innerHTML=${JSON.stringify(markup)}`;
const provider = () => vi.fn<typeof fetch>()
  .mockResolvedValueOnce(new Response('<input name="token" value="form-token">', { headers: { 'Set-Cookie': 'session=test; HttpOnly' } }))
  .mockResolvedValueOnce(new Response(encoded(script)));
const request = (body: unknown, origin = 'http://localhost:4321') => new Request('http://localhost:4321/api/tools/tiktok/resolve', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('TikTok local MVP', () => {
  it('normalizes standard URLs and rejects unsupported or unsafe inputs', () => {
    expect(normalizeTikTokUrl(` ${sample}?lang=en#ignored `)).toBe(sample);
    for (const url of ['http://www.tiktok.com/@x/video/7705574984709688596', 'https://www.tiktok.com.evil.test/@x/video/7705574984709688596', 'https://user@www.tiktok.com/@x/video/7705574984709688596', 'https://www.tiktok.com:444/@x/video/7705574984709688596', 'https://vt.tiktok.com/example/', 'https://127.0.0.1/']) expect(() => normalizeTikTokUrl(url)).toThrow();
  });
  it('decodes supported changing parameters without executing upstream scripts', () => {
    expect(decodeTikmateResponse(encoded(script))).toBe(script);
    expect(decodeTikmateResponse(encoded(script, 6))).toBe(script);
    expect(() => decodeTikmateResponse('<script>eval(function(h,u,n,t,e,r){}("BBB",88,"BbXlFzequ",45,8,3))</script>')).toThrow();
    expect(() => decodeTikmateResponse('<script>fetch("https://evil.invalid")</script>')).toThrow();
  });
  it('extracts trusted resource data and text while ignoring relative links and ads', () => {
    expect(extractTikmateResult(script)).toEqual({ title: 'Sample & video', cover: 'https://p16-sign-sg.tiktokcdn.com/cover.jpg', videos: [{ url: 'https://d.rapidcdn.app/v2?token=TEST&dl=1' }] });
    expect(() => extractTikmateResult('document.body.innerHTML="<a href=\'javascript:alert(1)\'>bad</a>"')).toThrow();
  });
  it('resolves through fixed endpoints with bounded responses, no media proxy or persistent state', async () => {
    const fetcher = provider();
    const result = await resolveTikTok(sample, fetcher);
    expect(result.videos).toHaveLength(1);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://tikmate.io/', 'https://tikmate.io/abc.php']);
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('error');
    expect(String(fetcher.mock.calls[1][1]?.body)).toContain('token=form-token');
  });
  it('fails closed on Provider errors and response limits', async () => {
    await expect(resolveTikTok(sample, vi.fn<typeof fetch>().mockResolvedValue(new Response('denied', { status: 403 })))).rejects.toThrow();
    await expect(resolveTikTok(sample, vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_048_577))))).rejects.toThrow();
    await expect(resolveTikTok(sample, vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>changed</html>')))).rejects.toThrow();
  });
  it('keeps production, remote hosts, cross-origin, invalid operation and oversized input away from Provider', async () => {
    const fetcher = provider();
    expect((await createTikTokHandler(false, fetcher)(request({}))).status).toBe(404);
    const handler = createTikTokHandler(true, fetcher);
    expect((await handler(request({}, 'https://evil.invalid'))).status).toBe(403);
    expect((await handler(new Request('https://example.com/api/tools/tiktok/resolve', { method: 'POST' }))).status).toBe(403);
    expect((await handler(request({ operation: 'paid', url: sample }))).status).toBe(400);
    expect((await handler(request({ operation: 'tiktok-video-resolve', url: 'x'.repeat(3000) }))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns no-store JSON and serializes Provider admission locally', async () => {
    const handler = createTikTokHandler(true, provider());
    const response = await handler(request({ operation: 'tiktok-video-resolve', url: sample }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).videos).toHaveLength(1);
    expect((await handler(request({ operation: 'tiktok-video-resolve', url: sample }))).status).toBe(429);
  });
  it('redacts upstream errors', async () => {
    const handler = createTikTokHandler(true, vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-cookie-and-url')));
    const response = await handler(request({ operation: 'tiktok-video-resolve', url: sample }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-cookie');
  });
  it('requires shared admission in production and fails closed before Provider calls', async () => {
    const fetcher = provider();
    const input = () => new Request('https://www.watermarkgemini.com/api/tools/tiktok/resolve', {
      method: 'POST', headers: { Origin: 'https://www.watermarkgemini.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'tiktok-video-resolve', url: sample }),
    });
    expect((await createTikTokHandler(true, fetcher, { localOnly: false })(input())).status).toBe(503);
    const release = vi.fn(async () => {});
    expect((await createTikTokHandler(true, fetcher, { localOnly: false, admission: { acquire: async () => null, release } })(input())).status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
    const handler = createTikTokHandler(true, fetcher, { localOnly: false, admission: { acquire: async () => 'lease', release } });
    expect((await handler(input())).status).toBe(200);
    expect(release).toHaveBeenCalledWith('lease');
    const failedRelease = vi.fn(async () => {});
    expect((await createTikTokHandler(true, vi.fn<typeof fetch>().mockRejectedValue(new Error('private')), {
      localOnly: false, admission: { acquire: async () => 'failed-lease', release: failedRelease },
    })(input())).status).toBe(502);
    expect(failedRelease).toHaveBeenCalledWith('failed-lease');
  });
});
