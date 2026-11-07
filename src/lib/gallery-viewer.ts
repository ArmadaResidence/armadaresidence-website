/**
 * The one photo viewer (GalleryViewer.astro) of /gallery/ and the branch pages' photo strip (7 Nov 2026; moved here
 * from the gallery page unchanged). Items are elements carrying data-src / data-srcset / data-avif / data-alt / data-w /
 * data-h / data-href / data-page and a [data-gallery-open] button; `visible()` gives the current order (the gallery's
 * filter). dataLayer gallery_open { category } — nothing personal.
 */
import { isRtl } from './client';

type DL = { dataLayer?: unknown[] };
const push = (o: Record<string, string>) => {
  const w = window as unknown as DL;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(o);
};

export function bindViewer(dlg: HTMLDialogElement, items: HTMLElement[], visible: () => HTMLElement[], goTo: string): void {
  const img = dlg.querySelector<HTMLImageElement>('[data-gallery-v-img]')!;
  const avif = dlg.querySelector<HTMLSourceElement>('[data-gallery-v-avif]')!;
  const caption = dlg.querySelector<HTMLElement>('[data-gallery-v-caption]')!;
  const counter = dlg.querySelector<HTMLElement>('[data-gallery-v-counter]')!;
  const link = dlg.querySelector<HTMLAnchorElement>('[data-gallery-v-link]')!;
  const closeBtn = dlg.querySelector<HTMLButtonElement>('[data-gallery-v-close]')!;
  const frame = dlg.querySelector<HTMLElement>('[data-gallery-frame]')!;
  let list = visible();
  let at = 0;

  const show = (i: number) => {
    if (!list.length) return;
    at = (i + list.length) % list.length;
    const d = list[at].dataset;
    avif.srcset = d.avif || '';
    img.srcset = d.srcset || '';
    img.src = d.src || '';
    img.alt = d.alt || '';
    img.removeAttribute('aria-hidden');
    img.width = Number(d.w) || 1400;
    img.height = Number(d.h) || 933;
    caption.textContent = d.alt || '';
    counter.textContent = `${at + 1} / ${list.length}`;
    link.href = d.href || '#';
    link.textContent = (goTo || '{page}').replace('{page}', d.page || '');
  };
  const step = (by: number) => show(at + by);
  for (const li of items) {
    li.querySelector<HTMLButtonElement>('[data-gallery-open]')!.addEventListener('click', () => {
      list = visible();
      show(list.indexOf(li));
      dlg.showModal();
      closeBtn.focus();
      push({ event: 'gallery_open', category: li.dataset.category || '' });
    });
  }
  // focus returns to the thumbnail of the photo last shown
  dlg.addEventListener('close', () => {
    const btn = list[at]?.querySelector<HTMLButtonElement>('[data-gallery-open]');
    btn?.focus();
    // a strip scrolls that thumbnail into view
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  closeBtn.addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-gallery-v-prev]')!.addEventListener('click', () => step(-1));
  dlg.querySelector('[data-gallery-v-next]')!.addEventListener('click', () => step(1));
  dlg.addEventListener('keydown', (e) => {
    // the arrows follow the reading direction: in Arabic the next photo is to the left
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step((e.key === 'ArrowRight') !== isRtl(dlg) ? 1 : -1);
    } else if (e.key === 'Tab') {
      // keep Tab inside the viewer
      const f = Array.from(dlg.querySelectorAll<HTMLElement>('a[href], button'));
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  });
  // a press that starts and ends on the backdrop closes (the site's outside-press rule)
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dlg));
  dlg.addEventListener('pointerup', (e) => {
    if (downOnBackdrop && e.target === dlg) dlg.close();
    downOnBackdrop = false;
  });
  // swipe: a horizontal drag over 40 px moves one photo (towards the reading direction's next)
  let x0: number | null = null;
  let y0 = 0;
  frame.addEventListener('pointerdown', (e) => {
    x0 = e.clientX;
    y0 = e.clientY;
  });
  frame.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    step((dx < 0) !== isRtl(dlg) ? 1 : -1);
  });
  frame.addEventListener('pointercancel', () => (x0 = null));
}
