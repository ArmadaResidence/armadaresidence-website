/**
 * Blog articles (12 Oct 2026): content/articles/<slug>.<lang>.md through the `articles` collection (src/content.config.ts).
 *
 * The body is plain Markdown plus two block directives that render the site's own components inside the article:
 *
 *   :::photo                                   :::gallery
 *   /images/dining/caesar-salad | alt | caption /images/dining/a | alt
 *   :::                                        /images/dining/b | alt
 *                                              :::
 *
 * An image is referenced by its base path under public/ (the files are <base>-800.webp, <base>-1400.webp…, the same
 * convention as every approved photo). Each `##` section becomes one Reveal block; the intro before the first `##`
 * is never wrapped (it sits right under the h1). Format reference: content/articles/README.md.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';
import sharp from 'sharp';
import { COVER_PENDING } from '../content.config';
import { fill, lqip, localePath, taif, ui, type Locale, type Place } from './content';

export type Article = CollectionEntry<'articles'>['data'] & { id: string; body: string };

// build.py runs Astro from the project root; import.meta.url points into the bundle at build time
const PUBLIC = join(process.cwd(), 'public') + '/';
const WIDTHS = [400, 800, 1400, 1920];

/** Published articles of one language, newest first (ties: slug). Drafts never reach the build. */
export async function articles(locale: Locale): Promise<Article[]> {
  const all = await getCollection('articles', (e) => e.data.lang === locale && e.data.status === 'published');
  return all
    .map((e) => ({ ...e.data, id: e.id, body: e.body ?? '' }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/** Slugs published in BOTH languages — an article missing its twin is not built (qa.py fails on it). */
export async function publishedSlugs(): Promise<string[]> {
  const [ar, en] = await Promise.all([articles('ar'), articles('en')]);
  const enSlugs = new Set(en.map((a) => a.slug));
  return ar.map((a) => a.slug).filter((s) => enSlugs.has(s));
}

export const blogPath = (locale: Locale) => localePath(locale, '/blog/');
export const articlePath = (locale: Locale, slug: string) => localePath(locale, `/blog/${slug}/`);

/* ---------- dates, reading time ---------- */

export function formatDate(locale: Locale, iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    numberingSystem: 'latn',
    calendar: 'gregory',
    timeZone: 'UTC',
  }).format(d);
}

/** Reading time at ~200 words a minute, rounded up. */
export function readingMinutes(body: string): number {
  const words = body
    .replace(/:::[\s\S]*?:::/g, ' ')
    .replace(/[#>*_\[\]()|`-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** "دقيقة قراءة" / "دقيقتان للقراءة" / "{n} دقائق قراءة" (3–10) / "{n} دقيقة قراءة" (11+) — Arabic number agreement. */
export function minutesText(locale: Locale, body: string): string {
  const b = ui(locale).blog;
  const n = readingMinutes(body);
  if (n === 1) return b.minute_one;
  if (n === 2) return b.minute_two;
  return fill(n <= 10 ? b.minutes : b.minutes_many, { n });
}

/* ---------- images (cover + directives) ---------- */

export interface ArticleImage {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  lqip?: string;
}

const metaCache = new Map<string, { width: number; height: number } | null>();

/** Resolve an image base ("/images/dining/caesar-salad") to its WebP widths; null when no file exists. */
export async function resolveImage(base: string, alt: string, caption?: string): Promise<ArticleImage | null> {
  const clean = base.trim().replace(/\.webp$/, '').replace(/-\d+$/, '');
  const widths = WIDTHS.filter((w) => existsSync(`${PUBLIC}${clean.replace(/^\//, '')}-${w}.webp`));
  if (!widths.length) return null;
  const main = widths.includes(800) ? 800 : widths[0];
  const src = `${clean}-${main}.webp`;
  if (!metaCache.has(src)) {
    const m = await sharp(`${PUBLIC}${src.replace(/^\//, '')}`).metadata();
    metaCache.set(src, m.width && m.height ? { width: m.width, height: m.height } : null);
  }
  const meta = metaCache.get(src);
  if (!meta) return null;
  return {
    src,
    srcset: widths.map((w) => `${clean}-${w}.webp ${w}w`).join(', '),
    width: meta.width,
    height: meta.height,
    alt,
    caption,
    lqip: lqip(src),
  };
}

export function coverPending(a: Article): boolean {
  return a.cover === COVER_PENDING || a.cover.startsWith('[');
}

export async function coverImage(a: Article): Promise<ArticleImage | null> {
  return coverPending(a) ? null : resolveImage(a.cover, a.cover_alt);
}

/* ---------- FAQ (23 Oct 2026) ----------
   An article's FAQ is the ## section headed «أسئلة شائعة» / "Frequently asked questions": every paragraph that opens
   with a bold question (ending in ? or ؟) followed by its answer. The exact text feeds FAQPage JSON-LD; links keep
   their text only. Anything else in the section (e.g. the closing booking CTA) is ignored. */
const FAQ_HEADING = /^##\s+(أسئلة شائعة|Frequently asked questions)\s*$/;
export function faqFromBody(body: string): { q: string; a: string }[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => FAQ_HEADING.test(l.trim()));
  if (start === -1) return [];
  const out: { q: string; a: string }[] = [];
  const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').trim();
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = line.trim().match(/^\*\*(.+?[?؟])\*\*\s+(.+)$/);
    if (m) out.push({ q: plain(m[1]), a: plain(m[2]) });
  }
  return out;
}

/* ---------- body → segments ---------- */

export type Segment = { kind: 'html'; html: string } | { kind: 'photo'; image: ArticleImage } | { kind: 'gallery'; images: ArticleImage[] };
export interface Section {
  /** true for the intro (before the first ##) — never wrapped in a Reveal */
  intro: boolean;
  segments: Segment[];
}

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  renderer: {
    // h2/h3 get stable ids (anchors) from their text
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = tokens
        .map((t) => ('text' in t ? t.text : ''))
        .join('')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '');
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
    // external links open in a new tab; internal ones stay in the site (and through the router)
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const t = title ? ` title="${title}"` : '';
      if (/^https?:\/\//.test(href)) return `<a href="${href}"${t} rel="noopener" target="_blank">${text}</a>`;
      return `<a href="${href}"${t}>${text}</a>`;
    },
  },
});

/** Split the body into sections at each `##`, with photo / gallery directives as their own segments. */
export async function renderBody(body: string): Promise<Section[]> {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [{ intro: true, segments: [] }];
  let buf: string[] = [];
  const flush = () => {
    const md = buf.join('\n').trim();
    buf = [];
    if (md) sections[sections.length - 1].segments.push({ kind: 'html', html: marked.parse(md) as string });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.match(/^:::(photo|gallery)\s*$/);
    if (open) {
      flush();
      const items: string[] = [];
      for (i++; i < lines.length && !/^:::\s*$/.test(lines[i]); i++) if (lines[i].trim()) items.push(lines[i].trim());
      const images = (
        await Promise.all(
          items.map((it) => {
            const [base, alt = '', caption] = it.split('|').map((s) => s.trim());
            return resolveImage(base, alt, caption || undefined);
          }),
        )
      ).filter((x): x is ArticleImage => Boolean(x));
      if (open[1] === 'photo' && images[0]) sections[sections.length - 1].segments.push({ kind: 'photo', image: images[0] });
      if (open[1] === 'gallery' && images.length) sections[sections.length - 1].segments.push({ kind: 'gallery', images });
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      sections.push({ intro: false, segments: [] });
    }
    buf.push(line);
  }
  flush();
  return sections.filter((s) => s.segments.length);
}

/* ---------- related ---------- */

/** Up to `n` other articles sharing a tag or the branch; shared tags rank first, then same branch, then date. */
export function relatedArticles(all: Article[], a: Article, n = 3): Article[] {
  return all
    .filter((x) => x.slug !== a.slug)
    .map((x) => ({ x, tags: x.tags.filter((t) => a.tags.includes(t)).length, branch: x.branch === a.branch ? 1 : 0 }))
    .filter((r) => r.tags || r.branch)
    .sort((p, q) => q.tags - p.tags || q.branch - p.branch || q.x.date.localeCompare(p.x.date))
    .slice(0, n)
    .map((r) => r.x);
}

/** related_place → the Discover Taif place with that key (taif-guide.json → places[].key). */
export function relatedPlace(key: string | null | undefined): Place | undefined {
  return key ? taif.places.find((p) => (p as { key?: string }).key === key) : undefined;
}

export const placeAnchor = (p: Place) => `place-${(p as { key?: string }).key ?? p.id}`;

export function tagSlug(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}
