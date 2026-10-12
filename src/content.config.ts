/**
 * Content collections. Articles (blog, 12 Oct 2026): one Markdown file per language, content/articles/<slug>.<lang>.md.
 * This schema is the contract the phase-2 admin editor (module 3.10) writes to — keep field names and types stable.
 * Format and directives are documented in content/articles/README.md; qa.py re-checks the source files.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Cover placeholder until the approved photo arrives (rendered as the brand placeholder, never as text). */
export const COVER_PENDING = '[TODO(photo)]';

const articles = defineCollection({
  // ids are "<slug>.<lang>" — the frontmatter `slug` is shared by both languages, so it cannot be the entry id
  loader: glob({ base: './content/articles', pattern: '*.{ar,en}.md', generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    lang: z.enum(['ar', 'en']),
    title: z.string().min(1),
    seo_title: z.string().min(1).max(60),
    seo_description: z.string().min(1).max(155),
    tags: z.array(z.string().min(1)).min(1),
    branch: z.enum(['airport-road', 'shafa-road']),
    related_place: z.string().min(1).nullable().optional(),
    /** image base under public/ (files <base>-<width>.webp), or COVER_PENDING */
    cover: z.string().min(1),
    cover_alt: z.string().min(4),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(['published', 'draft']),
    author: z.string().min(1),
  }),
});

export const collections = { articles };
