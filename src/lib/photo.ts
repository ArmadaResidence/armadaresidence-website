/**
 * Progressive photos (item 13): marks each .photo-img as loaded once it has decoded (already-complete images at
 * init, otherwise on `load`) so the CSS can fade it in from a soft blur over the brand placeholder. Images that
 * fail still get the class (the alt text shows, nothing stays blurred).
 */
import { onPageLoad } from './client';

function mark(img: HTMLImageElement): void {
  img.classList.add('is-loaded');
}

onPageLoad(() => {
  document.querySelectorAll<HTMLImageElement>('img.photo-img:not(.is-loaded):not([data-photo-bound])').forEach((img) => {
    img.setAttribute('data-photo-bound', '');
    if (img.complete && img.naturalWidth > 0) mark(img);
    else {
      img.addEventListener('load', () => mark(img), { once: true });
      img.addEventListener('error', () => mark(img), { once: true });
      // src assigned later (lazy slides in the gallery): the load event fires then
    }
  });
});
