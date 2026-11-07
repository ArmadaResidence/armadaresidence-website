/**
 * The cookie banner's behaviour (Ahmed, 7 Nov 2026; DECISIONS.md 2026-11-07 «Cookie consent»). Base.astro has already
 * set the Consent Mode defaults (and applied a stored choice) before GTM; this module handles a choice:
 *   - «قبول الكل» → analytics + ads granted; «الضروري فقط» → both denied; «تخصيص» → the three switches, then «حفظ»;
 *   - each choice: gtag('consent', 'update', …), dataLayer consent_update { consent_analytics, consent_ads,
 *     consent_granted: 'essential,analytics,ads' }, localStorage armada-consent { v: the policy version, t: now,
 *     analytics, ads } — kept data-days (12 months); a new policy version asks again;
 *   - the footer's «إعدادات ملفات تعريف الارتباط» ([data-cookie-settings]) reopens the banner on the customize view with
 *     the stored choice; Esc then closes it unchanged, and focus goes back to the link.
 * While it is shown, <html data-consent-open> and --consent-h (its height) let the WhatsApp button rise above it.
 */
import { onPageLeave, onPageLoad } from './client';

const KEY = 'armada-consent';
type Choice = { v: string; t: number; analytics: boolean; ads: boolean };
type W = Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };

let ro: ResizeObserver | null = null;
let returnTo: HTMLElement | null = null;

function stored(version: string, days: number): Choice | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null') as Choice | null;
    if (c && c.v === version && typeof c.t === 'number' && Date.now() - c.t < days * 864e5) return c;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function track(banner: HTMLElement): void {
  ro?.disconnect();
  ro = new ResizeObserver(() => document.documentElement.style.setProperty('--consent-h', `${banner.offsetHeight}px`));
  ro.observe(banner);
}

function close(banner: HTMLElement): void {
  document.documentElement.removeAttribute('data-consent-open');
  document.documentElement.style.removeProperty('--consent-h');
  ro?.disconnect();
  ro = null;
  const back = returnTo;
  returnTo = null;
  if (back && document.contains(back)) back.focus();
  else if (banner.contains(document.activeElement)) (document.getElementById('main') ?? document.body).focus?.();
}

function decide(banner: HTMLElement, analytics: boolean, ads: boolean): void {
  const w = window as W;
  const a = analytics ? 'granted' : 'denied';
  const m = ads ? 'granted' : 'denied';
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag('consent', 'update', { analytics_storage: a, ad_storage: m, ad_user_data: m, ad_personalization: m });
  const granted = ['essential', ...(analytics ? ['analytics'] : []), ...(ads ? ['ads'] : [])].join(',');
  w.dataLayer.push({ event: 'consent_update', consent_analytics: a, consent_ads: m, consent_granted: granted });
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: banner.dataset.version || '', t: Date.now(), analytics, ads } satisfies Choice));
  } catch {
    /* storage unavailable: the choice holds for this page */
  }
  close(banner);
}

function init(): void {
  const banner = document.querySelector<HTMLElement>('[data-cookie-banner]');
  if (!banner || banner.dataset.bound) return;
  banner.dataset.bound = '1';
  const version = banner.dataset.version || '';
  const days = Number(banner.dataset.days) || 365;
  const prefs = banner.querySelector<HTMLElement>('[data-cookie-prefs]')!;
  const customize = banner.querySelector<HTMLButtonElement>('[data-cookie-customize]')!;
  const save = banner.querySelector<HTMLButtonElement>('[data-cookie-save]')!;
  const sw = (k: string) => banner.querySelector<HTMLInputElement>(`[data-cookie-cat="${k}"]`)!;

  const showPrefs = (on: boolean) => {
    prefs.hidden = !on;
    save.hidden = !on;
    customize.hidden = on;
    customize.setAttribute('aria-expanded', String(on));
  };
  const fill = () => {
    const c = stored(version, days);
    sw('analytics').checked = !!c?.analytics;
    sw('ads').checked = !!c?.ads;
  };
  fill();
  if (document.documentElement.hasAttribute('data-consent-open')) track(banner);

  banner.querySelector('[data-cookie-accept]')!.addEventListener('click', () => decide(banner, true, true));
  banner.querySelector('[data-cookie-essential]')!.addEventListener('click', () => decide(banner, false, false));
  customize.addEventListener('click', () => {
    showPrefs(true);
    sw('analytics').focus();
  });
  save.addEventListener('click', () => decide(banner, sw('analytics').checked, sw('ads').checked));
  banner.addEventListener('keydown', (e) => {
    // Esc closes a reopened banner (a choice already exists) without changing it
    if (e.key === 'Escape' && stored(version, days)) {
      e.preventDefault();
      close(banner);
    }
  });

  document.querySelectorAll<HTMLElement>('[data-cookie-settings]').forEach((link) => {
    if (link.dataset.bound) return;
    link.dataset.bound = '1';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      returnTo = link;
      fill();
      showPrefs(true);
      document.documentElement.setAttribute('data-consent-open', '');
      track(banner);
      sw('analytics').focus();
    });
  });
}

onPageLoad(init);
onPageLeave(() => {
  ro?.disconnect();
  ro = null;
});
