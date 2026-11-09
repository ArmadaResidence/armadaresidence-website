/**
 * The site header's behaviour (Header.astro): the theme toggle, the nav ink, the «فروعنا» menu, the mobile menu.
 * Moved out of the component's own script on 9 Nov 2026 (mobile LCP) and imported by Base.astro's script, so it is
 * not a separate request before the first paint. Unchanged otherwise.
 */
import { bindOnce, onOutsidePress, onPageLeave, onPageLoad, reducedMotion } from './client';

// nav ink: remembered across client-side navigations so it slides from the previous item to the new one
let inkMemory: { x: string; w: string } | null = null;
let activeNav: HTMLElement | null = null;
onPageLeave(() => {
  const ink = document.querySelector<HTMLElement>('[data-nav] .nav-ink');
  inkMemory = ink && ink.classList.contains('is-on') ? { x: ink.style.getPropertyValue('--x'), w: ink.style.getPropertyValue('--w') } : null;
});

onPageLoad(() => {
  // light / dark toggle — the initial value is set on <html> by Base.astro before first paint
  const theme = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (theme && bindOnce(theme)) {
    const sync = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      theme.setAttribute('aria-pressed', String(dark));
      theme.title = dark ? theme.dataset.labelLight || '' : theme.dataset.labelDark || '';
    };
    theme.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      // the explicit choice is remembered (light is the default for everyone — Base.astro); the browser bar follows
      try {
        localStorage.setItem('armada-theme', next);
      } catch {}
      document.querySelector('meta[data-theme-color]')?.setAttribute('content', next === 'dark' ? '#0F1F2B' : '#F3EFE7');
      sync();
    });
    sync();
  }
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const nav = document.getElementById('mobile-nav');
  if (btn && nav && bindOnce(btn)) {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('hidden', open);
      btn.querySelector('.icon-open')?.classList.toggle('hidden', !open);
      btn.querySelector('.icon-close')?.classList.toggle('hidden', open);
    });
  }

  const navEl = document.querySelector<HTMLElement>('[data-nav]');
  const ink = navEl?.querySelector<HTMLElement>('.nav-ink');
  if (navEl && ink && bindOnce(navEl)) {
    const links = Array.from(navEl.querySelectorAll<HTMLAnchorElement>('.nav-link'));
    activeNav = navEl.querySelector<HTMLElement>('.nav-link[aria-current], .nav-link[data-current]');
    const place = (a: HTMLElement, animate: boolean) => {
      if (!animate || reducedMotion()) ink.style.transition = 'none';
      // measured against the nav itself (the «فروعنا» wrapper is not the offset parent, but rects never depend on it)
      ink.style.setProperty('--x', `${a.getBoundingClientRect().left - navEl.getBoundingClientRect().left}px`);
      ink.style.setProperty('--w', String(a.offsetWidth));
      ink.classList.add('is-on');
      if (!animate || reducedMotion()) {
        void ink.offsetWidth;
        ink.style.transition = '';
      }
    };
    const rest = (animate: boolean) => (activeNav ? place(activeNav, animate) : ink.classList.remove('is-on'));
    if (inkMemory) {
      ink.style.transition = 'none';
      ink.style.setProperty('--x', inkMemory.x);
      ink.style.setProperty('--w', inkMemory.w);
      ink.classList.add('is-on');
      void ink.offsetWidth;
      ink.style.transition = '';
      rest(true);
    } else rest(false);
    links.forEach((a) => a.addEventListener('mouseenter', () => place(a, true)));
    navEl.addEventListener('mouseleave', () => rest(true));
    // focus inside the «فروعنا» panel keeps the ink under its button
    navEl.addEventListener('focusin', (e) => {
      const el = e.target as HTMLElement;
      const target = el.closest('[data-nav-props]')?.querySelector<HTMLElement>('[data-nav-props-toggle]') ?? el;
      if (target.classList.contains('nav-link')) place(target, true);
    });
    navEl.addEventListener('focusout', () => rest(true));
    document.fonts.ready.then(() => rest(false));
    let raf = 0;
    // per page: aborted on the next swap so resize listeners do not pile up across client-side navigations
    const ac = new AbortController();
    document.addEventListener('astro:before-swap', () => ac.abort(), { once: true });
    window.addEventListener(
      'resize',
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => rest(false));
      },
      { signal: ac.signal },
    );
  }

  // «فروعنا» disclosure (3 Nov 2026): a click toggles it; a mouse hover opens it and leaving closes what the hover
  // opened; Esc closes it and returns focus to the button; an outside press (start and end outside), focus leaving it
  // or a navigation closes it. Document listeners are aborted on the next swap, so nothing piles up.
  const props = document.querySelector<HTMLElement>('[data-nav-props]');
  const toggle = props?.querySelector<HTMLButtonElement>('[data-nav-props-toggle]');
  if (props && toggle && bindOnce(props)) {
    props.setAttribute('data-js', '');
    let by: 'hover' | 'click' | null = null;
    let leaveTimer = 0;
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    const set = (open: boolean, how: 'hover' | 'click' | null = null) => {
      clearTimeout(leaveTimer);
      by = open ? how : null;
      toggle.setAttribute('aria-expanded', String(open));
      props.toggleAttribute('data-open', open);
    };
    toggle.addEventListener('click', () => {
      // a click on a panel the hover opened keeps it open (it now stays until closed)
      if (isOpen() && by === 'hover') by = 'click';
      else set(!isOpen(), 'click');
    });
    props.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(leaveTimer);
      if (!isOpen()) set(true, 'hover');
    });
    props.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || by !== 'hover') return;
      leaveTimer = window.setTimeout(() => set(false), 150);
    });
    props.addEventListener('focusout', (e) => {
      if (isOpen() && by !== 'hover' && !props.contains(e.relatedTarget as Node | null)) set(false);
    });
    props.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => set(false)));
    const ac = new AbortController();
    document.addEventListener(
      'astro:before-swap',
      () => {
        set(false);
        ac.abort();
      },
      { once: true },
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !isOpen()) return;
        const inside = props.contains(document.activeElement);
        set(false);
        if (inside) toggle.focus();
      },
      { signal: ac.signal },
    );
    onOutsidePress(() => [props], () => set(false), { signal: ac.signal, active: isOpen });
  }
});
