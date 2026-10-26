/* ==========================================================================
   Armada Residence — /partners/ behaviour.
   Adapted from the legacy B2B site.js: same reveal, parallax, count-up and
   rooming calculator. The legacy header/sticky bar are gone (site chrome replaces them); the three-step enquiry
   wizard lives in src/lib/partners-enquiry.ts (bundled with /partners/enquiry/).
   ========================================================================== */
(function () {
  'use strict';

  var IS_AR = document.documentElement.lang === 'ar';
  var BOOT = {};
  try { BOOT = JSON.parse(document.getElementById('armada-partners-cfg').textContent); } catch (e) { BOOT = {}; }
  var T = BOOT.i18n || {};
  var CFG = BOOT.cfg || {};
  var UNITS = BOOT.units || [];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── reveal on scroll ───────────────────────────────────────────────── */
  var rv = $$('.legacy-partners .rv');
  if (rv.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    rv.forEach(function (el) { io.observe(el); });
  } else {
    rv.forEach(function (el) { el.classList.add('in'); });
  }

  /* ── hero: quiet parallax on scroll only ─────────────────────────────── */
  var noMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var heroBg = $('.hero-v3 .bg img');
  if (heroBg && !noMotion) {
    var pRaf = null;
    window.addEventListener('scroll', function () {
      if (pRaf) return;
      pRaf = requestAnimationFrame(function () {
        pRaf = null;
        var y = Math.min(window.pageYOffset, 900);
        heroBg.style.transform = 'scale(1.06) translateY(' + (y * 0.12).toFixed(1) + 'px)';
      });
    }, { passive: true });
  }
  var heroEl = $('.hero-v3');
  if (heroEl && !noMotion) {
    var gRaf = null, gx = 0, gy = 0;
    heroEl.addEventListener('pointermove', function (e) {
      var r = heroEl.getBoundingClientRect();
      gx = (e.clientX - r.left) / r.width * 100; gy = (e.clientY - r.top) / r.height * 100;
      if (gRaf) return;
      gRaf = requestAnimationFrame(function () {
        gRaf = null;
        heroEl.style.setProperty('--gx', gx.toFixed(1) + '%');
        heroEl.style.setProperty('--gy', gy.toFixed(1) + '%');
      });
    });
  }

  /* ── stat numbers count up once the strip is in view ────────────────── */
  var nums = $$('.strip .it b, .built-nums b');
  if (nums.length && !noMotion && 'IntersectionObserver' in window) {
    var nio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        nio.unobserve(e.target);
        var raw = e.target.textContent.trim();
        var m = raw.match(/^(\D*)(\d+)(.*)$/);
        if (!m) return;
        var target = parseInt(m[2], 10), start = performance.now(), dur = 1100;
        (function tick(now) {
          var k = Math.min(1, (now - start) / dur); k = 1 - Math.pow(1 - k, 3);
          e.target.textContent = m[1] + Math.round(target * k) + m[3];
          if (k < 1) requestAnimationFrame(tick);
        })(start);
      });
    }, { threshold: 0.4 });
    nums.forEach(function (n) { nio.observe(n); });
  }

  /* ══ ENQUIRY FORM ═══════════════════════════════════════════════════
     Moved to src/lib/partners-enquiry.ts (26 Oct 2026): it shares the booking form's rules (rules.ts) and shows a
     notice before restoring a saved draft. */

  /* ══ ROOMING CALCULATOR ════════════════════════════════════════════ */
  /* Built from the published room types (rooms.json via content/partners-pages.json) and their capacities.
     It suggests combinations; it never claims stock. */
  var calc = $('#calc');
  if (calc && UNITS.length) {
    var nm = function (u) { return IS_AR ? u.ar : u.en; };
    function combos(guests, style, prop) {
      var pool = UNITS.filter(function (u) { return prop === 'both' || u.props.indexOf(prop) !== -1; });
      var out = [];
      function push(title, parts, note) {
        var total = parts.reduce(function (a, p) { return a + p.n; }, 0);
        out.push({ title: title, parts: parts, total: total, note: note });
      }
      function byCap(cap, keys) {
        return pool.filter(function (u) { return u.cap === cap && (!keys || keys.indexOf(u.key) !== -1); });
      }
      if (style === 'twin' || style === 'mixed') {
        var t = byCap(2, ['twin'])[0] || byCap(2)[0];
        if (t) {
          if (style === 'mixed') {
            var s = byCap(1)[0];
            var leaders = Math.min(2, Math.max(1, Math.round(guests / 20)));
            var rest = Math.max(0, guests - (s ? leaders : 0));
            var parts = [];
            if (s) parts.push({ u: s, n: leaders });
            parts.push({ u: t, n: Math.ceil(rest / 2) });
            push(IS_AR ? 'قادة منفردون والمجموعة ثنائية' : 'Leaders single, party twin-share', parts, null);
          } else {
            push(IS_AR ? 'تسكين ثنائي بالكامل' : 'All twin-share', [{ u: t, n: Math.ceil(guests / 2) }], null);
          }
        }
      }
      if (style === 'single') {
        var sg = byCap(1)[0];
        if (sg) push(IS_AR ? 'إشغال فردي' : 'Single occupancy', [{ u: sg, n: guests }], null);
        var kg = byCap(2, ['king'])[0];
        if (kg) push(IS_AR ? 'غرف كينج بإشغال فردي' : 'King rooms, single occupancy', [{ u: kg, n: guests }], IS_AR ? 'غرفة أوسع لكل ضيف' : 'A larger room per guest');
      }
      if (style === 'family') {
        pool.filter(function (u) { return u.cap === 4; }).forEach(function (u) {
          push(nm(u), [{ u: u, n: Math.ceil(guests / 4) }], null);
        });
        var s1 = byCap(3)[0];
        if (s1) push(nm(s1), [{ u: s1, n: Math.ceil(guests / 3) }], null);
      }
      if (guests >= 10 && style !== 'family') {
        var big = pool.filter(function (u) { return u.cap === 4; })[0];
        var tw = byCap(2, ['twin'])[0];
        if (big && tw) {
          var nBig = Math.floor(guests / 8);
          var left = guests - nBig * 4;
          push(IS_AR ? 'مزيج أجنحة وغرف ثنائية' : 'Suites plus twin rooms',
            [{ u: big, n: nBig }, { u: tw, n: Math.ceil(left / 2) }],
            IS_AR ? 'مناسب لتوزيع العائلات مع بقية المجموعة' : 'Useful when families travel with the wider party');
        }
      }
      return out.slice(0, 4);
    }
    $('.calc-go', calc).addEventListener('click', function () {
      var g = parseInt($('#calc-guests', calc).value, 10);
      var style = $('#calc-style', calc).value;
      var prop = $('#calc-prop', calc).value;
      var out = $('.out', calc);
      if (!g || g < 1) { $('#calc-guests', calc).focus(); return; }
      if (g > 400) g = 400;
      var res = combos(g, style, prop);
      var html = '';
      if (!res.length) {
        html = '<p class="lede">' + (IS_AR ? 'اختر فندقًا آخر أو نمط تسكين مختلف لعرض التركيبات.' : 'Choose another property or rooming style to see combinations.') + '</p>';
      }
      res.forEach(function (r) {
        var parts = r.parts.filter(function (p) { return p.n > 0; }).map(function (p) {
          return '<b>' + p.n + '</b> × ' + nm(p.u);
        }).join(' + ');
        html += '<div class="opt"><div class="t"><b>' + r.title + '</b><span class="m">' + r.total + ' ' + (T.unitsWord || 'units') + '</span></div><p>' + parts + (r.note ? ' — ' + r.note : '') + '</p></div>';
      });
      html += '<div class="note lt" style="margin-top:14px">' + (T.calcCaveat || '') + '</div>';
      var propSlug = prop === 'airport' ? 'airport-road' : prop === 'shafa' ? 'shafa-road' : 'both';
      html += '<a class="btn dk wide" style="margin-top:16px" href="' + (CFG.enquiryUrl || '/partners/enquiry/') +
        '?request=umrah-group&property=' + encodeURIComponent(propSlug) + '&guests=' + g + '">' + (T.calcSend || 'Send to the commercial office') + '</a>';
      out.innerHTML = html;
      out.classList.add('on');
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
})();
