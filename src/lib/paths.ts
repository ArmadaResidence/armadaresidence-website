import type { Locale } from './content';

/** Arabic at "/", English under "/en/". Used by every page in src/pages/[...lang]/. */
export function langPaths(): { params: { lang: string | undefined }; props: { locale: Locale } }[] {
  return [
    { params: { lang: undefined }, props: { locale: 'ar' } },
    { params: { lang: 'en' }, props: { locale: 'en' } },
  ];
}
