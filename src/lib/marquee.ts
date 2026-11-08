/**
 * The home page's partners strip (HomePartners.astro, 7 Nov 2026): a seamless, slow, continuous loop of the logos —
 * the set and its aria-hidden copy side by side, moved by `translate` (transform only, never layout); one full loop
 * per --motion-marquee (40 s), in the reading direction. Paused while the mouse is over the strip, while it is off
 * screen (IntersectionObserver) or the tab is hidden; a drag with the mouse or by touch moves it by hand (horizontal
 * drags only — a vertical swipe still scrolls the page), then the loop carries on from there. prefers-reduced-motion
 * (or a 0 token): nothing moves — the CSS shows one static row and hides the copy.
 */
import { isRtl, motionToken, onPageLeave, onPageLoad, reducedMotion, startAfterPaint } from './client';

const stops: (() => void)[] = [];

function init(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('[data-marquee-track]');
  const set = root.querySelector<HTMLElement>('[data-marquee-set]');
  const loop = motionToken('marquee');
  if (!track || !set || reducedMotion() || loop <= 0) return;
  root.setAttribute('data-marquee-on', '');
  // a seamless loop needs the copy at least as wide as the strip: with few logos, repeat them in the (hidden) copy
  const copy = root.querySelector<HTMLElement>('[data-marquee-copy]');
  const fill = () => {
    if (!copy) return;
    const proto = Array.from(copy.children).slice(0, set.children.length);
    let guard = 0;
    while (copy.getBoundingClientRect().width < root.getBoundingClientRect().width && guard++ < 12) {
      proto.forEach((li) => copy.appendChild(li.cloneNode(true)));
    }
  };
  fill();
  const dir = isRtl(root) ? 1 : -1; // LTR moves leftwards, RTL rightwards
  let width = set.getBoundingClientRect().width;
  let offset = 0; // 0 … width, in px along the reading direction
  let hovered = false;
  let dragging = false;
  let visible = true;
  let last = 0;
  let raf = 0;
  const wrap = (x: number) => ((x % width) + width) % width;
  const paint = () => {
    track.style.translate = `${dir * offset}px 0`;
  };
  const frame = (now: number) => {
    const dt = last ? Math.min(now - last, 100) : 0;
    last = now;
    if (!hovered && !dragging && width > 0) {
      offset = wrap(offset + (width / loop) * dt);
      paint();
    }
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (raf || !visible || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  root.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') hovered = true;
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hovered = false;
  });
  // drag by hand: horizontal moves only (touch-action: pan-y keeps vertical swipes for the page)
  let x0 = 0;
  let o0 = 0;
  let id = -1;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    id = e.pointerId;
    x0 = e.clientX;
    o0 = offset;
    root.setPointerCapture(id);
    root.classList.add('is-dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== id) return;
    // moving the pointer in the loop's direction advances it
    offset = wrap(o0 + (e.clientX - x0) * dir);
    paint();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    dragging = false;
    id = -1;
    root.classList.remove('is-dragging');
    if (e.pointerType !== 'mouse') hovered = false;
    last = 0;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) start();
    else stop();
  });
  io.observe(root);
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  // the logos load lazily: re-measure the set whenever its size changes
  const ro = new ResizeObserver(() => {
    fill();
    width = set.getBoundingClientRect().width;
    offset = width ? wrap(offset) : 0;
    paint();
  });
  ro.observe(set);
  ro.observe(root);
  start();
  stops.push(() => {
    stop();
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
  });
}

onPageLeave(() => {
  stops.forEach((f) => f());
  stops.length = 0;
});
// below the fold: started after the first paint (8 Nov 2026 — it clones and measures the logos on start)
onPageLoad(() => document.querySelectorAll<HTMLElement>('[data-marquee]').forEach((root) => startAfterPaint(root, 'marquee-bound', init)));
