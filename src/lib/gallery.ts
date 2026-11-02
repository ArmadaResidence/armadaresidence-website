/**
 * The gallery page /gallery/ («المعرض» / "Gallery", Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Gallery page»): the
 * photos PUBLISHED in the dashboard «الصور» (content/media.generated.json) — never rooms.json / branches.json imports —
 * of the branches (cover, gallery, the 4 story scenes), the room types (cover, gallery), the dining venues that have a
 * page, and the hall. Discover Taif place covers and the partners slots are not in it; a photo whose «إظهار في المعرض»
 * is off is left out.
 * Order: branch photos, then rooms, then dining, then the hall — branches and room types in site order, each target's
 * photos in its «الصور» order (cover first, then the gallery by its sort, then the story scenes).
 * The page, its nav link (after «طريق الشفا») and its sitemap entry exist only once at least GALLERY_MIN photos qualify.
 */
import { branches, hallPath, halls, L, localePath, media, roomPath, roomsFor, venueName, venuePages, venuePath, type Locale, type SitePhoto } from './content';

export const GALLERY_MIN = 6;
/** the filters, in display order (each shown only when it has photos) */
export const GALLERY_FILTERS = ['all', 'airport-road', 'shafa-road', 'rooms', 'dining', 'hall'] as const;
export type GalleryFilter = (typeof GALLERY_FILTERS)[number];
/** a photo's category: its branch for a branch photo, else what it shows (the dataLayer's gallery_open category) */
export type GalleryCategory = 'airport-road' | 'shafa-road' | 'rooms' | 'dining' | 'hall';

export interface GalleryItem {
  photo: SitePhoto & { in_gallery?: boolean };
  branch: string;
  category: GalleryCategory;
  /** the page the photo belongs to, in each language */
  href: Record<Locale, string>;
  /** that page's name, in each language (the lightbox link) */
  page: Record<Locale, string>;
}

type Img = SitePhoto & { in_gallery?: boolean };
const shown = (p: Img) => p.in_gallery !== false;
const both = (f: (l: Locale) => string): Record<Locale, string> => ({ ar: f('ar'), en: f('en') });
const STORY = ['entrance', 'lobby', 'rooms', 'dining'];

function build(): GalleryItem[] {
  const out: GalleryItem[] = [];
  const push = (list: Img[], it: Omit<GalleryItem, 'photo'>) => list.filter(shown).forEach((photo) => out.push({ photo, ...it }));
  for (const b of branches) {
    const m = media.branches?.[b.slug];
    if (!m) continue;
    const story = STORY.map((k) => m.story?.[k]).filter(Boolean) as Img[];
    push([...(m.photos as Img[]), ...story], { branch: b.slug, category: b.slug as GalleryCategory, href: both((l) => localePath(l, `/${b.slug}/`)), page: both((l) => L(l, b, 'name')) });
  }
  for (const b of branches) {
    for (const r of roomsFor(b.slug)) {
      const m = media.rooms?.[`${r.branch}/${r.slug}`];
      if (!m) continue;
      push(m.photos as Img[], { branch: b.slug, category: 'rooms', href: both((l) => roomPath(l, r)), page: both((l) => `${L(l, r, 'name')} — ${L(l, b, 'name')}`) });
    }
  }
  // a venue's photos only when its page exists (an active venue, or a coming-soon teaser once /dining/ exists)
  for (const v of venuePages) {
    const m = media.dining?.[v.slug];
    if (m) push(m.photos as Img[], { branch: v.branch, category: 'dining', href: both((l) => venuePath(l, v)), page: both((l) => venueName(l, v)) });
  }
  for (const h of halls) {
    const m = media.halls?.[h.slug];
    if (m) push(m.photos as Img[], { branch: h.branch, category: 'hall', href: both((l) => hallPath(l, h)), page: both((l) => L(l, h, 'name')) });
  }
  return out;
}

export const galleryItems: GalleryItem[] = build();
/** /gallery/ exists (page, nav link, sitemap entry) only from GALLERY_MIN photos (Ahmed, 2 Nov 2026) */
export const galleryLive: boolean = galleryItems.length >= GALLERY_MIN;

/** does the photo belong under this filter (a branch filter: every photo of that branch) */
export function inFilter(it: GalleryItem, f: GalleryFilter): boolean {
  if (f === 'all') return true;
  if (f === 'airport-road' || f === 'shafa-road') return it.branch === f;
  return it.category === f;
}
/** the filters that have photos (الكل always, while the page exists) */
export const galleryFilters: GalleryFilter[] = GALLERY_FILTERS.filter((f) => galleryItems.some((it) => inFilter(it, f)));
/** the page's og:image: the social crop of the first target that has one (branch, room, venue, hall — in gallery order) */
export const galleryOg: string | undefined = [
  ...branches.map((b) => media.branches?.[b.slug]?.og_image),
  ...Object.values(media.rooms ?? {}).map((r) => r.og_image),
  ...venuePages.map((v) => media.dining?.[v.slug]?.og_image),
  ...halls.map((h) => media.halls?.[h.slug]?.og_image),
].find((x): x is string => typeof x === 'string' && x.length > 0);
