/* Adapted from the legacy Discover Taif app.js for armadaresidence.com/discover-taif/:
   language is fixed per page (no switch), the legacy header/menu is gone, everything else is as designed. */
/* =============================================================
   Armada Residence — اكتشف الطائف / Discover Taif
   Static client-side behaviour. No backend, no data collection.
   ============================================================= */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var STORAGE_PLAN = "armada-taif-plan";

  var PLACES = [];
  try {
    PLACES = JSON.parse(document.getElementById("places-data").textContent);
  } catch (e) {
    PLACES = [];
  }

  var COLLECTIONS = {};
  try {
    COLLECTIONS = JSON.parse(document.getElementById("collections-data").textContent);
  } catch (e) {
    COLLECTIONS = {};
  }

  var T = {
    ar: {
      resultCount: function (n, total) {
        return "عرض " + n + " من " + total + " وجهة";
      },
      planCount: function (n) {
        return "خطتي، " + n + " وجهة محفوظة";
      },
      added: "تمت الإضافة إلى خطتي",
      removed: "تمت الإزالة من خطتي",
      cleared: "تم مسح خطتي",
      copied: "تم نسخ الخطة إلى الحافظة",
      copiedLink: "تم نسخ الرابط",
      shareFail: "تعذّرت المشاركة، جرّب النسخ",
      planShareTitle: "خطتي في الطائف",
      planShareFooter: "دليلك إلى الطائف من أرمادا ريزيدنس",
      confirmClear: "هل تريد مسح جميع الوجهات من خطتي؟",
      openMaps: "فتح الاتجاهات في خرائط Google إلى ",
      removeFrom: "إزالة من خطتي: ",
      addTo: "أضف إلى خطتي: ",
      shareOf: "مشاركة وجهة: "
    },
    en: {
      resultCount: function (n, total) {
        return "Showing " + n + " of " + total + " places";
      },
      planCount: function (n) {
        return "My Plan, " + n + " places saved";
      },
      added: "Added to My Plan",
      removed: "Removed from My Plan",
      cleared: "My Plan cleared",
      copied: "Plan copied to clipboard",
      copiedLink: "Link copied",
      shareFail: "Sharing unavailable, copy instead",
      planShareTitle: "My Taif plan",
      planShareFooter: "Your guide to Taif by Armada Residence",
      confirmClear: "Clear all places from My Plan?",
      openMaps: "Open directions in Google Maps to ",
      removeFrom: "Remove from My Plan: ",
      addTo: "Add to My Plan: ",
      shareOf: "Share place: "
    }
  };

  var lang = root.getAttribute("lang") === "en" ? "en" : "ar";
  var state = { query: "", category: "all", collection: null };
  var plan = [];

  /* ---------------------------------------------------------- helpers */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }
  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function normalise(str) {
    return (str || "")
      .toString()
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g, "")
      .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
      .replace(/\u0649/g, "\u064A")
      .replace(/\u0629/g, "\u0647")
      .replace(/[\u200C-\u200F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function placeById(id) {
    for (var i = 0; i < PLACES.length; i++) {
      if (PLACES[i].id === id) return PLACES[i];
    }
    return null;
  }

  var toastEl = $("#toast");
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove("is-visible");
    }, 2600);
  }

  /* ---------------------------------------------------------- language (fixed per page) */
  function applyLanguage() {
    applyFilters();
    renderPlan();
  }

  /* ---------------------------------------------------------- filtering */
  var cards = $$(".card");
  var countEl = $("#result-count");
  var clearBtn = $("#clear-filters");
  var emptyState = $("#empty-state");
  var searchInput = $("#search");
  var searchClear = $("#search-clear");

  function matchesSearch(card) {
    if (!state.query) return true;
    return normalise(card.dataset.search).indexOf(normalise(state.query)) !== -1;
  }

  function matchesCategory(card) {
    if (state.collection) {
      return COLLECTIONS[state.collection].places.indexOf(card.dataset.id) !== -1;
    }
    return state.category === "all" || card.dataset.cat === state.category;
  }

  function applyFilters() {
    var shown = 0;
    cards.forEach(function (card) {
      var visible = matchesCategory(card) && matchesSearch(card);
      card.classList.toggle("is-hidden", !visible);
      if (visible) shown++;
    });

    if (countEl) countEl.textContent = T[lang].resultCount(shown, cards.length);
    if (emptyState) emptyState.classList.toggle("is-visible", shown === 0);

    var dirty = state.query !== "" || state.category !== "all" || state.collection !== null;
    if (clearBtn) clearBtn.hidden = !dirty;

    $$(".chip").forEach(function (chip) {
      var active = !state.collection && chip.dataset.cat === state.category;
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
    $$(".collection-card").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.dataset.collection === state.collection ? "true" : "false");
    });

    if (searchClear) searchClear.classList.toggle("is-visible", state.query !== "");
    revealVisibleCards();
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      state.query = searchInput.value;
      applyFilters();
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", function () {
      searchInput.value = "";
      state.query = "";
      searchInput.focus();
      applyFilters();
    });
  }

  $$(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.category = chip.dataset.cat;
      state.collection = null;
      applyFilters();
    });
  });

  $$(".collection-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.dataset.collection;
      state.collection = state.collection === key ? null : key;
      state.category = "all";
      applyFilters();
      var target = document.getElementById("places");
      if (target && state.collection) {
        target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      state.query = "";
      state.category = "all";
      state.collection = null;
      if (searchInput) searchInput.value = "";
      applyFilters();
    });
  }

  /* ---------------------------------------------------------- my plan */
  function loadPlan() {
    var raw = read(STORAGE_PLAN);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (id) { return !!placeById(id); });
    } catch (e) {
      return [];
    }
  }

  function savePlan() {
    store(STORAGE_PLAN, JSON.stringify(plan));
  }

  var planFab = $("#plan-fab");
  var planBadge = $("#plan-badge");
  var planList = $("#plan-list");
  var planEmpty = $("#plan-empty");
  var planActions = $("#plan-actions");

  function mapsIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>';
  }
  function trashIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M4 7h16M9.5 7V5h5v2M6.5 7l.8 12.1A1.9 1.9 0 0 0 9.2 21h5.6a1.9 1.9 0 0 0 1.9-1.9L17.5 7"/></svg>';
  }

  function renderPlan() {
    var count = plan.length;
    if (planBadge) planBadge.textContent = String(count);
    if (planFab) {
      planFab.classList.toggle("is-visible", count > 0);
      planFab.setAttribute("aria-label", T[lang].planCount(count));
    }
    if (planEmpty) planEmpty.hidden = count > 0;
    if (planActions) planActions.hidden = count === 0;
    if (!planList) return;

    planList.innerHTML = "";
    plan.forEach(function (id) {
      var place = placeById(id);
      if (!place) return;

      var li = document.createElement("li");
      li.className = "plan-item";

      var img = document.createElement("img");
      img.src = place.thumb;
      img.alt = lang === "ar" ? place.altAr : place.altEn;
      img.loading = "lazy";
      img.width = 72;
      img.height = 54;

      var text = document.createElement("div");
      var name = document.createElement("p");
      name.className = "plan-name";
      name.textContent = lang === "ar" ? place.nameAr : place.nameEn;
      var sub = document.createElement("p");
      sub.className = "plan-sub";
      sub.textContent = lang === "ar" ? place.nameEn : place.nameAr;
      var near = document.createElement("a");
      near.className = "plan-sub";
      near.href = place.bookHref;
      near.textContent = place.branch;
      text.appendChild(name);
      text.appendChild(sub);
      text.appendChild(near);

      var actions = document.createElement("div");
      actions.className = "plan-item-actions";

      var multi = place.maps.length > 1;
      var links = null;
      if (multi) {
        links = document.createElement("div");
        links.className = "plan-links";
      }

      place.maps.forEach(function (entry) {
        var label = lang === "ar" ? entry.labelAr : entry.labelEn;
        var link = document.createElement("a");
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", T[lang].openMaps + label);
        link.setAttribute("title", label);
        if (multi) {
          link.className = "btn btn-outline btn-sm";
          link.innerHTML = mapsIcon() + "<span></span>";
          link.querySelector("span").textContent = label;
          links.appendChild(link);
        } else {
          link.className = "btn-icon";
          link.innerHTML = mapsIcon();
          actions.appendChild(link);
        }
      });

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-icon";
      remove.innerHTML = trashIcon();
      remove.setAttribute("aria-label", T[lang].removeFrom + (lang === "ar" ? place.nameAr : place.nameEn));
      remove.addEventListener("click", function () {
        togglePlan(id, false);
      });
      actions.appendChild(remove);

      li.appendChild(img);
      li.appendChild(text);
      li.appendChild(actions);
      if (links) li.appendChild(links);
      planList.appendChild(li);
    });

    $$(".btn-plan").forEach(function (btn) {
      btn.setAttribute("aria-pressed", plan.indexOf(btn.dataset.id) !== -1 ? "true" : "false");
      var place = placeById(btn.dataset.id);
      if (place) {
        btn.setAttribute("aria-label", T[lang].addTo + (lang === "ar" ? place.nameAr : place.nameEn));
      }
    });
  }

  function togglePlan(id, force) {
    var index = plan.indexOf(id);
    var shouldAdd = typeof force === "boolean" ? force : index === -1;
    if (shouldAdd && index === -1) {
      plan.push(id);
      toast(T[lang].added);
    } else if (!shouldAdd && index !== -1) {
      plan.splice(index, 1);
      toast(T[lang].removed);
    }
    savePlan();
    renderPlan();
  }

  $$(".btn-plan").forEach(function (btn) {
    btn.addEventListener("click", function () { togglePlan(btn.dataset.id); });
  });

  /* ---------------------------------------------------------- sheet */
  var sheet = $("#plan-sheet");
  var overlay = $("#sheet-overlay");
  var sheetClose = $("#sheet-close");
  var lastFocused = null;

  function openSheet() {
    lastFocused = document.activeElement;
    sheet.classList.add("is-open");
    overlay.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("sheet-open");
    if (sheetClose) sheetClose.focus();
  }

  function closeSheet() {
    sheet.classList.remove("is-open");
    overlay.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("sheet-open");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  $$("[data-open-plan]").forEach(function (btn) {
    btn.addEventListener("click", openSheet);
  });
  if (sheetClose) sheetClose.addEventListener("click", closeSheet);
  if (overlay) overlay.addEventListener("click", closeSheet);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && sheet.classList.contains("is-open")) {
      closeSheet();
      return;
    }
    if (event.key !== "Tab" || !sheet.classList.contains("is-open")) return;
    var focusables = $$('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])', sheet)
      .filter(function (el) { return el.offsetParent !== null; });
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---------------------------------------------------------- sharing */
  function copyText(text, message) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(message); }, function () { legacyCopy(text, message); });
    } else {
      legacyCopy(text, message);
    }
  }

  function legacyCopy(text, message) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      toast(message);
    } catch (e) {
      toast(T[lang].shareFail);
    }
    document.body.removeChild(area);
  }

  $$(".btn-share").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var place = placeById(btn.dataset.id);
      if (!place) return;
      var name = lang === "ar" ? place.nameAr : place.nameEn;
      var url = place.maps[0].url;
      var payload = { title: name, text: name, url: url };
      if (navigator.share) {
        navigator.share(payload).catch(function () {});
      } else {
        copyText(name + " — " + url, T[lang].copiedLink);
      }
    });
  });

  function planShareText() {
    var lines = [T[lang].planShareTitle, ""];
    plan.forEach(function (id) {
      var place = placeById(id);
      if (!place) return;
      var name = lang === "ar" ? place.nameAr : place.nameEn;
      if (place.maps.length === 1) {
        lines.push("• " + name + " — " + place.maps[0].url);
      } else {
        lines.push("• " + name);
        place.maps.forEach(function (entry) {
          lines.push("   - " + (lang === "ar" ? entry.labelAr : entry.labelEn) + " — " + entry.url);
        });
      }
    });
    lines.push("");
    lines.push(T[lang].planShareFooter);
    return lines.join("\n");
  }

  var sharePlanBtn = $("#share-plan");
  if (sharePlanBtn) {
    sharePlanBtn.addEventListener("click", function () {
      if (!plan.length) return;
      var text = planShareText();
      if (navigator.share) {
        navigator.share({ title: T[lang].planShareTitle, text: text }).catch(function () {});
      } else {
        copyText(text, T[lang].copied);
      }
    });
  }

  var clearPlanBtn = $("#clear-plan");
  if (clearPlanBtn) {
    clearPlanBtn.addEventListener("click", function () {
      if (!plan.length) return;
      if (!window.confirm(T[lang].confirmClear)) return;
      plan = [];
      savePlan();
      renderPlan();
      toast(T[lang].cleared);
    });
  }

  /* ---------------------------------------------------------- reveal */
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  var observer = null;
  if ("IntersectionObserver" in window && !prefersReducedMotion()) {
    root.classList.add("reveal-on");
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  }

  function revealVisibleCards() {
    if (!observer) return;
    cards.forEach(function (card) {
      if (card.classList.contains("is-hidden") || card.classList.contains("is-visible")) return;
      observer.observe(card);
    });
  }

  /* ---------------------------------------------------------- init */
  plan = loadPlan();
  applyLanguage();
})();
