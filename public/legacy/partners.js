/* ==========================================================================
   Armada Residence — /partners/ behaviour.
   Adapted from the legacy B2B site.js: same reveal, parallax, count-up, rooming calculator and
   three-step enquiry wizard. The legacy header/sticky bar are gone (site chrome replaces them) and the
   enquiry is sent to the booking-request Edge Function with request_type; WhatsApp / email stay as fallbacks.
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

  /* ══ ENQUIRY FORM ═══════════════════════════════════════════════════ */
  var form = $('#enquiry-form');
  var STORE = 'armada_b2b_enquiry_v1';

  function paramPrefill() {
    if (!form) return;
    var q = new URLSearchParams(location.search);
    var map = { property: 'property', request: 'reqtype', biz: 'biztype' };
    Object.keys(map).forEach(function (k) {
      var v = q.get(k);
      if (!v) return;
      var el = form.elements[map[k]];
      if (el) el.value = v;
    });
    ['guests', 'rooms'].forEach(function (k) {
      var v = q.get(k);
      if (v && form.elements[k] && !form.elements[k].value) form.elements[k].value = v;
    });
  }
  function saveState() {
    if (!form) return;
    try {
      var d = {};
      $$('input,select,textarea', form).forEach(function (el) { if (el.name) d[el.name] = el.value; });
      localStorage.setItem(STORE, JSON.stringify(d));
    } catch (e) { /* private mode */ }
  }
  function loadState() {
    if (!form) return;
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var d = JSON.parse(raw);
      Object.keys(d).forEach(function (k) {
        var el = form.elements[k];
        if (el && !el.value) el.value = d[k];
      });
    } catch (e) { /* ignore */ }
  }

  var stepIdx = 0;
  var fsteps = $$('.fstep', form || document);
  var psteps = $$('.pstep', form || document);

  function paintSteps() {
    fsteps.forEach(function (s, i) { s.classList.toggle('on', i === stepIdx); });
    psteps.forEach(function (p, i) {
      p.classList.toggle('on', i === stepIdx);
      p.classList.toggle('done', i < stepIdx);
    });
    var last = stepIdx === fsteps.length - 1;
    var back = $('.f-back', form), next = $('.f-next', form);
    if (back) back.style.display = stepIdx === 0 ? 'none' : '';
    if (next) next.style.display = last ? 'none' : '';
    ['.f-send', '.f-wa', '.f-mail'].forEach(function (s) {
      var b = $(s, form); if (b) b.style.display = last ? '' : 'none';
    });
  }

  function validateStep(i) {
    var ok = true;
    $$('[required]', fsteps[i]).forEach(function (el) {
      var fld = el.closest('.fld');
      var bad = !el.value.trim();
      if (!bad && el.type === 'email') bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim());
      if (!bad && el.type === 'tel') bad = !/^\+[1-9]\d{7,14}$/.test(el.value.replace(/[\s\-().]/g, '').replace(/^00/, '+'));
      if (fld) fld.classList.toggle('bad', bad);
      if (bad && ok) { el.focus(); ok = false; }
    });
    return ok;
  }

  if (form) {
    paramPrefill();
    loadState();
    paintSteps();
    form.addEventListener('input', saveState);
    form.addEventListener('change', saveState);
    var nextBtn = $('.f-next', form), backBtn = $('.f-back', form);
    if (nextBtn) nextBtn.addEventListener('click', function () {
      if (!validateStep(stepIdx)) return;
      stepIdx = Math.min(stepIdx + 1, fsteps.length - 1);
      paintSteps();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (backBtn) backBtn.addEventListener('click', function () {
      stepIdx = Math.max(stepIdx - 1, 0);
      paintSteps();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $$('.fld input,.fld select', form).forEach(function (el) {
      el.addEventListener('input', function () { var f = el.closest('.fld'); if (f) f.classList.remove('bad'); });
    });
  }

  function labelFor(name) {
    var el = form.elements[name];
    if (!el) return name;
    var fld = el.closest('.fld');
    var lab = fld ? $('label', fld) : null;
    return lab ? lab.textContent.replace('*', '').trim() : name;
  }
  function readableValue(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
      var o = el.options[el.selectedIndex];
      return o && o.value ? o.textContent.trim() : '';
    }
    return (el.value || '').trim();
  }
  function buildMessage() {
    var order = ['company', 'person', 'email', 'phone', 'country', 'biztype', 'reqtype', 'property',
      'checkin', 'checkout', 'guests', 'rooms', 'unittype', 'meals', 'notes'];
    var lines = [T.waIntro || 'New B2B enquiry', ''];
    order.forEach(function (n) {
      var v = readableValue(n);
      if (v) lines.push(labelFor(n) + ': ' + v);
    });
    lines.push('', (IS_AR ? 'أُرسل من ' : 'Sent from ') + location.origin + location.pathname);
    return lines.join('\n');
  }
  function validateAll() {
    for (var i = 0; i < fsteps.length; i++) {
      if (!validateStep(i)) { stepIdx = i; paintSteps(); return false; }
    }
    return true;
  }
  function showError(msg) {
    var e = $('#enquiry-error');
    if (!e) return;
    e.textContent = msg;
    e.style.display = 'block';
  }
  function sendVia(channel) {
    if (!validateAll()) return;
    var msg = buildMessage();
    if (channel === 'wa') {
      window.open('https://wa.me/' + CFG.phone + '?text=' + encodeURIComponent(msg), '_blank');
    } else {
      var subj = (T.waIntro || 'B2B enquiry') + ' — ' + (readableValue('company') || '');
      location.href = 'mailto:' + CFG.sales + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(msg);
    }
  }
  /* send to the Edge Function (same endpoint as the booking form) */
  function payload() {
    var v = function (n) { return (form.elements[n] && form.elements[n].value || '').trim(); };
    var extra = [];
    if (v('biztype')) extra.push(labelFor('biztype') + ': ' + readableValue('biztype'));
    if (v('country')) extra.push(labelFor('country') + ': ' + v('country'));
    if (v('unittype')) extra.push(labelFor('unittype') + ': ' + v('unittype'));
    if (v('notes')) extra.push(v('notes'));
    return {
      locale: CFG.locale || (IS_AR ? 'ar' : 'en'),
      request_type: v('reqtype'),
      organisation: v('company'),
      branch: v('property') || 'both',
      check_in: v('checkin'),
      check_out: v('checkout'),
      adults: v('guests'),
      children: '0',
      rooms: v('rooms'),
      meals: v('meals'),
      room: '',
      name: v('person'),
      phone: v('phone').replace(/[\s\-().]/g, '').replace(/^00/, '+'),
      email: v('email'),
      notes: extra.join('\n').slice(0, 1000),
      page: location.href
    };
  }
  function sendToOffice() {
    if (!validateAll()) return;
    if (!CFG.endpoint) { showError(T.sendFail || ''); sendVia('wa'); return; }
    var btn = $('.f-send', form);
    if (btn) btn.disabled = true;
    var headers = { 'Content-Type': 'application/json' };
    if (CFG.anonKey) { headers.Authorization = 'Bearer ' + CFG.anonKey; headers.apikey = CFG.anonKey; }
    fetch(CFG.endpoint, { method: 'POST', headers: headers, body: JSON.stringify(payload()) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.ok || !res.body.ref) throw new Error('send failed');
        var box = $('#enquiry-sent');
        $('#enquiry-sent-title').textContent = T.sentTitle || '';
        $('#enquiry-sent-body').textContent = T.sentBody || '';
        $('#enquiry-sent-ref-label').textContent = T.sentRef || '';
        $('#enquiry-sent-ref').textContent = res.body.ref;
        box.hidden = false;
        form.hidden = true;
        try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'partner_enquiry', request_type: payload().request_type, branch: payload().branch, booking_ref: res.body.ref });
      })
      .catch(function () { showError(T.sendFail || ''); })
      .then(function () { if (btn) btn.disabled = false; });
  }
  var waBtn = $('.f-wa'), mailBtn = $('.f-mail');
  if (waBtn) waBtn.addEventListener('click', function (e) { e.preventDefault(); sendVia('wa'); });
  if (mailBtn) mailBtn.addEventListener('click', function (e) { e.preventDefault(); sendVia('mail'); });
  if (form) form.addEventListener('submit', function (e) { e.preventDefault(); sendToOffice(); });

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
