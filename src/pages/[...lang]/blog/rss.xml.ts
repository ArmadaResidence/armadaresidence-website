/**
 * /blog/rss.xml and /en/blog/rss.xml (3 Nov 2026 — «المدونة»): one RSS 2.0 feed per language, the articles published in
 * that language, newest first (title, link, guid, publication date, the excerpt or the SEO description, the tags as
 * categories). Linked from the blog pages' head; not an HTML page (never in the sitemap).
 */
import type { APIContext } from 'astro';
import { langPaths } from '@lib/paths';
import { articlePath, articles, blogPath } from '@lib/articles';
import { absoluteUrl, pageSeo, siteName, ui, type Locale } from '@lib/content';

export const getStaticPaths = langPaths;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// noon UTC of the article's day: the same calendar day in Riyadh and in the reader's feed
const rfc822 = (iso: string) => new Date(`${iso}T12:00:00Z`).toUTCString();

export async function GET({ props }: APIContext) {
  const locale = (props as { locale: Locale }).locale;
  const list = await articles(locale);
  const s = pageSeo(locale, 'blog');
  const items = list
    .map((a) => {
      const url = absoluteUrl(articlePath(locale, a.slug));
      return [
        '    <item>',
        `      <title>${esc(a.title)}</title>`,
        `      <link>${esc(url)}</link>`,
        `      <guid isPermaLink="true">${esc(url)}</guid>`,
        `      <pubDate>${rfc822(a.date)}</pubDate>`,
        `      <description>${esc(a.excerpt || a.seo_description)}</description>`,
        ...a.tags.map((t) => `      <category>${esc(t)}</category>`),
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  const self = absoluteUrl(`${blogPath(locale)}rss.xml`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${ui(locale).blog.heading} — ${siteName(locale)}`)}</title>
    <link>${esc(absoluteUrl(blogPath(locale)))}</link>
    <description>${esc(s.description)}</description>
    <language>${locale === 'ar' ? 'ar-SA' : 'en'}</language>
    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml" />
${list[0] ? `    <lastBuildDate>${rfc822(list[0].updated ?? list[0].date)}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
