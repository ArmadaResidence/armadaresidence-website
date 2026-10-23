// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const seo = JSON.parse(readFileSync(new URL('./content/seo.json', import.meta.url), 'utf8'));
const roomsJson = JSON.parse(readFileSync(new URL('./content/rooms.json', import.meta.url), 'utf8'));
const redirects = JSON.parse(readFileSync(new URL('./redirects.json', import.meta.url), 'utf8'));

/** noindex pages are excluded from the sitemap (CLAUDE.md §7): sold-out rooms, booking success, 404. */
const noindexPaths = [
  '/booking/success/',
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

export default defineConfig({
  site: seo.site_url,
  output: 'static',
  trailingSlash: 'always',
  compressHTML: true,
  build: { format: 'directory' },
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
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
