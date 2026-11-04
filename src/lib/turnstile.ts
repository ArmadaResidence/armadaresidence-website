/**
 * Cloudflare Turnstile for the public forms (Ahmed, 4 Nov 2026 — content/turnstile.json). Off by default: without the
 * <meta name="armada-turnstile"> that Base.astro writes only when the setting is on and a site key exists, every call
 * answers null at once and nothing is loaded (no request to Cloudflare).
 * On: the script loads on the first submit (render=explicit), a widget is rendered just before the form's submit button
 * with appearance «interaction-only» (invisible unless Cloudflare asks for a click — Managed or Invisible mode is set in
 * Cloudflare's dashboard), the token is returned and the widget removed (a token is single-use). Any failure → '' (the
 * server then refuses with 403 «challenge» and the form shows its usual failure message and WhatsApp hand-off).
 */
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __armadaTurnstileReady?: () => void;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__armadaTurnstileReady';
let loading: Promise<TurnstileApi | null> | null = null;

export const turnstileSiteKey = (): string =>
  document.querySelector<HTMLMetaElement>('meta[name="armada-turnstile"]')?.content?.trim() ?? '';

function load(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve) => {
    const done = (v: TurnstileApi | null) => resolve(v);
    window.__armadaTurnstileReady = () => done(window.turnstile ?? null);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      loading = null;
      done(null);
    };
    document.head.appendChild(s);
    setTimeout(() => done(window.turnstile ?? null), 10000);
  });
  return loading;
}

/** a fresh token for one submission, or null when Turnstile is off ('' when it is on but failed) */
export async function turnstileToken(form: HTMLElement, anchor?: HTMLElement | null): Promise<string | null> {
  const key = turnstileSiteKey();
  if (!key) return null;
  const api = await load();
  if (!api) return '';
  const box = document.createElement('div');
  box.className = 'turnstile-box';
  box.setAttribute('data-turnstile', '');
  const before = anchor ?? form.querySelector<HTMLElement>('button[type="submit"], .f-send');
  (before?.parentElement ?? form).insertBefore(box, before ?? null);
  return new Promise<string>((resolve) => {
    let id = '';
    const finish = (t: string) => {
      try {
        if (id) api.remove(id);
      } catch { /* already gone */ }
      box.remove();
      resolve(t);
    };
    const timer = setTimeout(() => finish(''), 60000);
    try {
      id = api.render(box, {
        sitekey: key,
        appearance: 'interaction-only',
        size: 'flexible',
        language: document.documentElement.lang || 'auto',
        callback: (t: string) => {
          clearTimeout(timer);
          finish(t);
        },
        'error-callback': () => {
          clearTimeout(timer);
          finish('');
        },
        'expired-callback': () => {
          clearTimeout(timer);
          finish('');
        },
      });
    } catch {
      clearTimeout(timer);
      finish('');
    }
  });
}
