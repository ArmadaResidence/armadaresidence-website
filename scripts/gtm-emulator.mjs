// A stand-in gtm.js for the browser checks (20 Nov 2026 — DECISIONS.md 2026-11-20 «Careers privacy»). Google compiles
// the real gtm.js from the published container, so an unpublished change cannot be loaded; this script runs the firing
// rules of docs/gtm-container.json itself against the dataLayer the real site pushes:
//   - Consent Mode: the gtag('consent', 'default' | 'update', …) commands, in order;
//   - triggers: All Pages (gtm.js) and Custom Event triggers with EQUALS / CONTAINS / STARTS_WITH / ENDS_WITH /
//     MATCH_REGEX conditions on {{_event}}, {{Page Path}} and the container's Data Layer variables;
//   - a tag fires on an event when one of its firing triggers matches, none of its exception (blocking) triggers
//     matches and every consent type it needs is granted;
//   - a Meta, TikTok, Snapchat or Clarity tag that fires sends ONE request to its platform's host
//     (https://<host>/__gtm-emulator?tag=…&event=…) — the check aborts and counts them; nothing reaches a platform;
//   - any other Custom HTML tag without a platform (the «first interaction or 5 s» engagement timer) runs its own code.
// What it does not prove: Google's own compiler and the published container. Tag Assistant does that after the import
// (docs/gtm-import-careers-privacy.md).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOSTS = { meta: 'connect.facebook.net', tiktok: 'analytics.tiktok.com', snap: 'tr.snapchat.com', clarity: 'www.clarity.ms' };
export const EMULATOR_HOSTS = new RegExp(Object.values(HOSTS).map((h) => h.replace(/\./g, '\\.')).join('|'));

export function emulatorScript(file = resolve(ROOT, 'docs/gtm-container.json')) {
  const c = JSON.parse(readFileSync(file, 'utf8')).containerVersion;
  const arg = (x, k) => x.parameter.find((p) => p.key === k)?.value ?? '';
  const conds = (list) => (list ?? []).map((x) => ({ t: x.type, a: arg(x, 'arg0'), b: arg(x, 'arg1') }));
  const triggers = Object.fromEntries(c.trigger.map((t) => [t.triggerId, { type: t.type, ce: conds(t.customEventFilter), f: conds(t.filter) }]));
  const vars = Object.fromEntries(c.variable.filter((v) => v.type === 'v').map((v) => [v.name, arg(v, 'name')]));
  const tags = [];
  for (const t of c.tag) {
    const code = t.type === 'html' ? arg(t, 'html') : '';
    const platform = /fbq/.test(code) ? 'meta' : /ttq/.test(code) ? 'tiktok' : /snaptr/.test(code) ? 'snap' : t.name === 'Clarity' ? 'clarity' : '';
    if (!platform && !(t.type === 'html' && t.consentSettings?.consentStatus !== 'NEEDED')) continue;
    tags.push({
      name: t.name,
      host: platform ? HOSTS[platform] : '',
      run: platform ? '' : [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'),
      once: t.tagFiringOption === 'ONCE_PER_LOAD',
      firing: t.firingTriggerId ?? [],
      blocking: t.blockingTriggerId ?? [],
      consent: t.consentSettings?.consentStatus === 'NEEDED' ? t.consentSettings.consentType.list.map((x) => x.value) : [],
    });
  }
  const config = JSON.stringify({ triggers, vars, tags });
  return `(function (C) {
  var w = window, dl = (w.dataLayer = w.dataLayer || []), model = {}, consent = {}, ev = '', fired = {};
  w.__gtmEmulator = { fired: [] };
  function val(ref) {
    var n = ref.replace(/^\\{\\{|\\}\\}$/g, '');
    if (n === '_event' || n === 'Event') return ev;
    if (n === 'Page Path') return location.pathname;
    return C.vars[n] ? model[C.vars[n]] : undefined;
  }
  function ok(c) {
    var a = val(c.a);
    a = a == null ? '' : String(a);
    if (c.t === 'EQUALS') return a === c.b;
    if (c.t === 'CONTAINS') return a.indexOf(c.b) >= 0;
    if (c.t === 'STARTS_WITH') return a.indexOf(c.b) === 0;
    if (c.t === 'ENDS_WITH') return a.slice(-c.b.length) === c.b;
    if (c.t === 'MATCH_REGEX') return new RegExp(c.b).test(a);
    return false;
  }
  function on(id) {
    if (id === '2147479553') return ev === 'gtm.js';
    var t = C.triggers[id];
    return !!t && t.ce.every(ok) && t.f.every(ok);
  }
  function handle(x) {
    if (!x || typeof x !== 'object') return;
    if (typeof x.length === 'number' && !Array.isArray(x)) {
      if (x[0] === 'consent' && x[2]) for (var k in x[2]) consent[k] = x[2][k];
      return;
    }
    for (var m in x) if (m !== 'event') model[m] = x[m];
    if (!x.event) return;
    ev = x.event;
    C.tags.forEach(function (t) {
      if (t.once && fired[t.name]) return;
      if (!t.firing.some(on) || t.blocking.some(on)) return;
      if (t.consent.some(function (k) { return consent[k] !== 'granted'; })) return;
      fired[t.name] = 1;
      w.__gtmEmulator.fired.push({ tag: t.name, event: ev, path: location.pathname });
      if (t.host) {
        new Image().src = 'https://' + t.host + '/__gtm-emulator?tag=' + encodeURIComponent(t.name) + '&event=' + encodeURIComponent(ev) + '&path=' + encodeURIComponent(location.pathname);
      } else if (t.run) {
        var s = document.createElement('script');
        s.text = t.run.replace(/\\{\\{[^}]+\\}\\}/g, 'null');
        document.head.appendChild(s);
      }
    });
  }
  var queued = dl.slice();
  var push = dl.push;
  dl.push = function () {
    var r = push.apply(dl, arguments);
    for (var i = 0; i < arguments.length; i++) handle(arguments[i]);
    return r;
  };
  queued.forEach(handle);
})(${config});`;
}
