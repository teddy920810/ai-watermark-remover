export function splitInlineLinks(copy: string, canonicalOrigin: string) {
  const origin = new URL(canonicalOrigin).origin;
  const parts: { text: string; href?: string }[] = [];
  const links = /\[([^\]\r\n]+)\]\((https:\/\/[^\s()\\]+|\/(?!\/)[^\s()\\]*)\)/gi;
  let cursor = 0;

  for (const match of copy.matchAll(links)) {
    const [source, label, destination] = match;
    const url = URL.parse(destination, origin);
    if (!url || url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) continue;

    const index = match.index;
    if (index > cursor) parts.push({ text: copy.slice(cursor, index) });
    parts.push({ text: label, href: url.href });
    cursor = index + source.length;
  }

  if (cursor < copy.length) parts.push({ text: copy.slice(cursor) });
  return parts;
}
