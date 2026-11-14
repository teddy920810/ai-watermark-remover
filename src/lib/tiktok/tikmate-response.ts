import { parse } from 'acorn';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

function walk(input: unknown, visitor: (node: Record<string, unknown>) => void) {
  if (!input || typeof input !== 'object') return;
  if (Array.isArray(input)) { input.forEach(value => walk(value, visitor)); return; }
  const node = input as Record<string, unknown>;
  visitor(node);
  Object.values(node).forEach(value => { if (value && typeof value === 'object') walk(value, visitor); });
}

/** Read only literal data. Acorn parses syntax; no upstream JavaScript runs.
 * https://github.com/acornjs/acorn/tree/master/acorn#interface
 */
export function decodeTikmateResponse(html: string): string {
  let decoded = '';
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    walk(parse(match[1], { ecmaVersion: 2020 }), node => {
      const callee = node.callee as { type?: string; params?: { name: string }[] } | undefined;
      if (node.type !== 'CallExpression' || callee?.type !== 'FunctionExpression' || callee.params?.map(p => p.name).join(',') !== 'h,u,n,t,e,r') return;
      const args = node.arguments as { type: string; value: unknown }[];
      if (args.length !== 6 || args.some(arg => arg.type !== 'Literal')) throw new Error('Unsupported encoding');
      const [payload, , alphabet, offset, radix] = args.map(arg => arg.value);
      if (typeof payload !== 'string' || typeof alphabet !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || typeof radix !== 'number' || !Number.isInteger(radix) || radix < 2 || radix > 10 || alphabet.length < radix + 1 || alphabet.length > 16 || new Set(alphabet).size !== alphabet.length || !payload.endsWith(alphabet[radix])) throw new Error('Unsupported encoding');
      const chunks = payload.split(alphabet[radix]); chunks.pop();
      const bytes = chunks.map(chunk => {
        if (!chunk || chunk.length > 16) throw new Error('Invalid encoding');
        let value = 0;
        for (const character of chunk) {
          const digit = alphabet.indexOf(character);
          if (digit < 0 || digit >= radix) throw new Error('Invalid encoding');
          value = value * radix + digit;
        }
        const byte = value - offset;
        if (!Number.isSafeInteger(byte) || byte < 0 || byte > 255) throw new Error('Invalid encoding');
        return byte;
      });
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    });
  }
  if (!decoded) throw new Error('Unsupported Provider response');
  return decoded;
}

export function trustedVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'd.rapidcdn.app' && url.pathname === '/v2' && !url.username && !url.password && !url.port && url.searchParams.has('token') && value.length < 16_384 ? url.href : null;
  } catch { return null; }
}

export function extractTikmateResult(decoded: string) {
  const urls = new Set<string>();
  let title = '', cover: string | null = null;
  walk(parse(decoded, { ecmaVersion: 2020 }), node => {
    const left = node.left as { property?: { name?: string } } | undefined;
    const right = node.right as { value?: unknown } | undefined;
    if (node.type !== 'AssignmentExpression' || left?.property?.name !== 'innerHTML' || typeof right?.value !== 'string') return;
    const fragment = parseFragment(right.value);
    function visit(element: DefaultTreeAdapterTypes.Node) {
      if ('tagName' in element) {
        const attrs = Object.fromEntries(element.attrs.map(attr => [attr.name, attr.value]));
        if (element.tagName === 'a' && attrs.href) { const url = trustedVideoUrl(attrs.href); if (url) urls.add(url); }
        if (element.tagName === 'h1' && !title) title = element.childNodes.filter(child => child.nodeName === '#text').map(child => (child as DefaultTreeAdapterTypes.TextNode).value).join('').slice(0, 300);
        if (element.tagName === 'img' && !cover && attrs.src) {
          try { const url = new URL(attrs.src); if (url.protocol === 'https:' && url.hostname.endsWith('.tiktokcdn.com') && !url.username && !url.password && !url.port && attrs.src.length < 16_384) cover = url.href; } catch { /* Optional image. */ }
        }
      }
      if ('childNodes' in element) element.childNodes.forEach(visit);
    }
    fragment.childNodes.forEach(visit);
  });
  if (!urls.size) throw new Error('No supported video resource');
  return { title, cover, videos: [...urls].slice(0, 8).map(url => ({ url })) };
}
