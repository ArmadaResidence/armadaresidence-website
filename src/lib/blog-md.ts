/**
 * Article Markdown safety (3 Nov 2026 — «المدونة»): ONE sanitiser for the dashboard editor (before a save) and the site
 * renderer (before marked). Article text is Markdown only — headings, bold, italic, lists, quotes, links and the
 * :::photo / :::gallery directives — so raw HTML never belongs in it:
 *   - every HTML tag and comment is removed (its text stays): <script>, <iframe>, <img onerror=…>, <a onclick=…>…;
 *   - a link or image whose target is not a site path, an anchor, http(s), mailto: or tel: keeps its text only
 *     (javascript:, vbscript:, data: and friends never reach a page).
 * Plain text and safe Markdown come back byte for byte (the seeded articles are unchanged by it).
 */

/** a link target an article may carry, else null */
export function safeHref(href: string | null | undefined): string | null {
  const h = String(href ?? '').trim();
  if (!h) return null;
  // strip control and whitespace characters a browser would ignore inside a scheme ("java\tscript:")
  const probe = h.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/.test(probe) && !/^(https?:|mailto:|tel:)/.test(probe)) return null;
  if (probe.startsWith('//')) return null;
  return h;
}

const TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>/g;
// the start of [text]( or ![alt]( — the target is then read up to its balanced closing parenthesis
const LINK_START = /(!?)\[([^\]\n]*)\]\(/g;

/** [text](target) / ![alt](target) whose target is unsafe → the text (a link) or nothing (an image) */
function stripUnsafeLinks(s: string): string {
  let out = '';
  let at = 0;
  LINK_START.lastIndex = 0;
  for (let m = LINK_START.exec(s); m; m = LINK_START.exec(s)) {
    let i = m.index + m[0].length;
    let depth = 1;
    for (; i < s.length && depth > 0 && s[i] !== '\n'; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
    }
    if (depth !== 0) continue; // not a complete link: leave it as text
    const inside = s.slice(m.index + m[0].length, i - 1);
    // the target is the inside without an optional "title"; the probe ignores spaces a browser would skip
    const target = inside.replace(/\s+"[^"]*"\s*$/, '').trim().replace(/^<|>$/g, '');
    if (safeHref(target) === null || safeHref(target.replace(/\s+/g, '')) === null) {
      out += s.slice(at, m.index) + (m[1] ? '' : m[2]);
      at = i;
      LINK_START.lastIndex = i;
    }
  }
  return out + s.slice(at);
}

export function sanitizeMarkdown(md: string): string {
  let out = String(md ?? '');
  // tags may hide inside each other (<scr<script>ipt>): repeat until nothing changes
  for (let i = 0; i < 5; i++) {
    const next = out.replace(TAG, '');
    if (next === out) break;
    out = next;
  }
  return stripUnsafeLinks(out);
}

/** true when the text carries something the sanitiser would remove */
export function unsafeMarkdown(md: string): boolean {
  return sanitizeMarkdown(md) !== String(md ?? '');
}
