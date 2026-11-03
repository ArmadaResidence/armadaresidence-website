// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';

const seo = JSON.parse(readFileSync(new URL('./content/seo.json', import.meta.url), 'utf8'));
const roomsJson = JSON.parse(readFileSync(new URL('./content/rooms.json', import.meta.url), 'utf8'));
const redirects = JSON.parse(readFileSync(new URL('./redirects.json', import.meta.url), 'utf8'));
const hallsJson = JSON.parse(readFileSync(new URL('./content/halls.json', import.meta.url), 'utf8'));
/** «المحتوى والظهور» (3 Nov 2026): what is hidden from the site (scripts/content-build.mjs; absent → nothing) */
const contentGenUrl = new URL('./content/content.generated.json', import.meta.url);
const hidden = (existsSync(contentGenUrl) ? JSON.parse(readFileSync(contentGenUrl, 'utf8')).hidden : null) ?? { branches: [], rooms: [], sections: [] };

/** noindex pages are excluded from the sitemap (CLAUDE.md §7): sold-out rooms, booking success, 404. */
const noindexPaths = [
  '/booking/success/',
  '/club/unsubscribe/',
  '/404/',
  ...roomsJson.rooms.filter((r) => r.show_on_site && r.availability === 'sold_out').map((r) => `/${r.branch}/${r.slug}/`),
];
const isNoindex = (page) => {
  const path = new URL(page).pathname.replace(/^\/en\//, '/');
  return noindexPaths.includes(path);
};

/** Old-site URLs → new slugs (CLAUDE.md §7). Kept in redirects.json; exact entries become static redirect pages,
 *  wildcard entries (via: "404") are handled by src/pages/404.astro. */
const redirectMap = Object.fromEntries(
  redirects.redirects
    .filter((r) => r.from && r.to && !r.from.includes('*'))
    .map((r) => [r.from, { status: 301, destination: r.to }]),
);

/** A page hidden in «المحتوى والظهور» (3 Nov 2026) has no page; its URL (both languages) redirects to its parent: a room
 *  to its branch (home when the branch is hidden too), a branch with its rooms and hall to home, the hall to its branch,
 *  the gallery / the offers page / dining (and its venue pages, by the 404 page's rule) to home. */
const hiddenPages = [];
const roomsOf = (b) => roomsJson.rooms.filter((r) => r.branch === b && r.show_on_site).map((r) => r.slug);
for (const b of hidden.branches) {
  hiddenPages.push([`/${b}`, '/'], ...roomsOf(b).map((s) => [`/${b}/${s}`, '/']));
  if (hallsJson.halls.some((h) => h.branch === b)) hiddenPages.push([`/${b}/hall`, '/']);
}
for (const key of hidden.rooms) {
  const [b, s] = key.split('/');
  if (!hidden.branches.includes(b)) hiddenPages.push([`/${b}/${s}`, `/${b}/`]);
}
if (hidden.sections.includes('hall')) for (const h of hallsJson.halls) if (!hidden.branches.includes(h.branch)) hiddenPages.push([`/${h.branch}/hall`, `/${h.branch}/`]);
for (const s of ['gallery', 'offers', 'dining']) if (hidden.sections.includes(s)) hiddenPages.push([`/${s}`, '/']);
for (const [from, to] of hiddenPages) {
  redirectMap[from] = { status: 301, destination: to };
  redirectMap[`/en${from}`] = { status: 301, destination: to === '/' ? '/en/' : `/en${to}` };
}

export default defineConfig({
  site: seo.site_url,
  output: 'static',
  trailingSlash: 'always',
  compressHTML: true,
  // the stylesheet is inlined in every page (performance pass, 30 Oct 2026): no render-blocking request before the
  // first paint; the whole sheet, not a critical subset, so nothing can flash unstyled (the dark theme and JS-set
  // states are styled from the first frame)
  build: { format: 'directory', inlineStylesheets: 'always' },
  i18n: {
    defaultLocale: 'ar',
    locales: ['ar', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  redirects: redirectMap,
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'ar',
        locales: { ar: 'ar', en: 'en' },
      },
      filter: (page) => !isNoindex(page),
      // /menu/ is the café app copied into public/ (scripts/menu-publish.py), not an Astro route — listed here (30 Oct 2026)
      customPages: [`${seo.site_url}/menu/`, `${seo.site_url}/en/menu/`],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
