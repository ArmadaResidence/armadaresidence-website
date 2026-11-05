// Cloudflare Turnstile in the browser checks (5 Nov 2026 — content/turnstile.json is on): the pages load
// challenges.cloudflare.com/turnstile/v0/api.js on the first submit. The checks never reach Cloudflare: this stub answers
// the script request with a fake `window.turnstile` whose widget hands back TURNSTILE_QA_TOKEN at once, so the forms send
// a token and the stubbed endpoints see it. Nothing else changes in a check.
//   import { stubTurnstile, TURNSTILE_QA_TOKEN, TURNSTILE_URL } from './turnstile-stub.mjs';
//   await stubTurnstile(ctx);   // a BrowserContext or a Page
export const TURNSTILE_QA_TOKEN = 'qa-turnstile-token';
export const TURNSTILE_URL = /^https:\/\/challenges\.cloudflare\.com\//;

const SCRIPT = `(() => {
  let n = 0;
  window.turnstile = {
    render(el, opts) {
      const id = 'qa-ts-' + (++n);
      el.setAttribute('data-qa-turnstile', id);
      setTimeout(() => { try { opts.callback && opts.callback(${JSON.stringify(TURNSTILE_QA_TOKEN)}); } catch (e) {} }, 0);
      return id;
    },
    remove() {},
    reset() {},
  };
  const m = /[?&]onload=([A-Za-z_$][\\w$]*)/.exec(document.currentScript ? document.currentScript.src : '');
  const ready = m ? window[m[1]] : null;
  if (typeof ready === 'function') setTimeout(ready, 0);
})();`;

export async function stubTurnstile(target) {
  await target.route(TURNSTILE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SCRIPT }));
}

// every stubbed form POST passes through noteTurnstile(body) (a parsed JSON body or the raw multipart text); at the end
// turnstileProblem() says what is wrong: while the setting is on, every submission carries the stub's token; while off, none.
import { readFileSync } from 'node:fs';
const setting = JSON.parse(readFileSync(new URL('../content/turnstile.json', import.meta.url), 'utf8'));
export const TURNSTILE_ON = setting.enabled === true && !!setting.site_key;
const tally = { posts: 0, with: 0 };
export function noteTurnstile(body) {
  tally.posts++;
  const s = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  if (s.includes(TURNSTILE_QA_TOKEN)) tally.with++;
}
export function turnstileProblem() {
  if (TURNSTILE_ON && tally.posts === 0) return 'no form submission was seen';
  if (TURNSTILE_ON && tally.with !== tally.posts) return `${tally.posts - tally.with} of ${tally.posts} submission(s) without the Turnstile token`;
  if (!TURNSTILE_ON && tally.with) return `${tally.with} submission(s) carry a Turnstile token while it is off`;
  return null;
}
