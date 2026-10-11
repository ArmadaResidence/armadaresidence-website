/**
 * Branch scroll story (item 10): the scene crossing the middle band of the viewport becomes active; the picture
 * column cross-fades to its image. One IntersectionObserver (rootMargin -45 % top/bottom), class toggles only.
 */
import { bindOnce, onPageLeave, onPageLoad } from './client';

const observers: IntersectionObserver[] = [];

function init(root: HTMLElement): void {
  const scenes = Array.from(root.querySelectorAll<HTMLElement>('[data-story-scene]'));
  const imgs = Array.from(root.querySelectorAll<HTMLElement>('[data-story-img]'));
  const index = root.querySelector<HTMLElement>('[data-story-index]');
  const template = index?.textContent?.trim() ?? '';
  const total = scenes.length;
  const activate = (i: number) => {
    scenes.forEach((s, j) => s.classList.toggle('is-active', j === i));
    imgs.forEach((im, j) => {
      im.classList.toggle('is-active', j === i);
      im.setAttribute('aria-hidden', String(j !== i));
    });
    if (index && template) index.textContent = template.replace(/\d+(?=\D*\d+\D*$)/, String(i + 1)).replace(/\d+(?=\D*$)/, String(total));
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) activate(scenes.indexOf(e.target as HTMLElement));
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
  );
  scenes.forEach((s) => io.observe(s));
  observers.push(io);
}

onPageLeave(() => {
  observers.forEach((o) => o.disconnect());
  observers.length = 0;
});

onPageLoad(() => {
  document.querySelectorAll<HTMLElement>('[data-story]').forEach((root) => bindOnce(root) && init(root));
});
