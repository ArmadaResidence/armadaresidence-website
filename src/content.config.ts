/**
 * Content collections. Articles (blog, 12 Oct 2026): one Markdown file per language. Since 3 Nov 2026 the dashboard
 * «المدونة» is the source: scripts/blog-build.mjs writes content/articles.generated/<slug>.<lang>.md from the published
 * articles (without the service key: a copy of content/articles, the seed). An article may exist in one language only.
 * This schema is the contract the editor writes to — keep field names and types stable.
 * Format and directives are documented in content/articles/README.md; qa.py re-checks the source files.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Cover placeholder until the approved photo arrives (rendered as the brand placeholder, never as text). */
export const COVER_PENDING = '[TODO(photo)]';

const articles = defineCollection({
  // ids are "<slug>.<lang>" — the frontmatter `slug` is shared by both languages, so it cannot be the entry id
  loader: glob({ base: './content/articles.generated', pattern: '*.{ar,en}.md', generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    lang: z.enum(['ar', 'en']),
    title: z.string().min(1),
    seo_title: z.string().min(1).max(60),
    seo_description: z.string().min(1).max(155),
    tags: z.array(z.string().min(1)).min(1),
    /** the booking box: one branch; "both" → both branch cards; null / absent (3 Nov 2026) → one box, no branch preselected */
    branch: z.enum(['airport-road', 'shafa-road', 'both']).nullable().optional(),
    related_place: z.string().min(1).nullable().optional(),
    /** image base under public/ (files <base>-<width>.webp), or COVER_PENDING; a cover published in «الصور» (target
     *  blog:<slug>, media.generated.json) takes precedence */
    cover: z.string().min(1),
    cover_alt: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(['published', 'draft']),
    author: z.string().min(1),
    /** the card's summary (3 Nov 2026); absent → seo_description */
    excerpt: z.string().optional(),
    /** a canonical other than the page itself (an absolute https URL or a site path) */
    canonical: z.string().optional(),
    /** the OG image: one of the article's photos in «الصور» (media item id); absent → the cover */
    og_media: z.string().optional(),
  }),
});

export const collections = { articles };
