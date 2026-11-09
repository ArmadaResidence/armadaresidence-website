// Which checks run where (CLAUDE.md §11). Since 9 Nov 2026 (Ahmed: this machine has 4 GB and Chrome ran out of memory
// in the hooks) the split is:
//   - local hooks (.githooks/pre-commit, pre-push): the FAST checks only — no browser: build.py, qa.py and FAST_CHECKS
//     below (a docs-only commit skips the build). Target under 5 minutes.
//   - GitHub Actions (.github/workflows/deploy.yml, every push to main and every deploy): everything else — the static
//     job (its own build without the service key, the fast checks again, the dashboard / email browser checks, the
//     sample qa), the browser checks in parallel shards against the build being deployed (CI_SHARDS), the pixel guard.
//     The deploy needs every one of those jobs.
//   - by hand, when needed: `node scripts/check-all.mjs` (the whole suite on this machine, one command).
// The routed plan of 31 Oct 2026 (the checks mapped to the staged files, RULES below) is kept for a manual run:
//   node scripts/check-all.mjs --staged --routed
//   node scripts/check-plan.mjs <file> [<file> …]   the routed plan for these paths (repo-relative)
//   node scripts/check-plan.mjs --staged            the routed plan for what is staged now
//   node scripts/check-plan.mjs --dry-run           the routed plan for one sample change of each kind
//   node scripts/check-plan.mjs --shards            the CI shards and the checks in each (--shards-json: the names)
// Rules: a file may match several rules (their checks add up); a file that matches no rule runs the full suite; a
// commit made only of docs skips the build (and qa.py, which reads dist/). When in doubt the rule runs more, never less.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// the suite, in the order check-all runs it
export const STATIC_CHECKS = ['typecheck', 'admin-digits-check', 'admin-format-check', 'admin-sidebar-check', 'admin-audit-check', 'auth-emails-check', 'whatsapp-check', 'email-print-check', 'offers-engine-check', 'turnstile-check', 'deploy-alert-check'];
export const BROWSER_CHECKS = ['booking-nav-check', 'drawer-check', 'booking-whatsapp-check', 'datepicker-check', 'motion-check', 'booking-instant-check', 'partners-form-check', 'careers-form-check', 'dining-site-check', 'gallery-site-check', 'offers-site-check', 'blog-site-check', 'faq-site-check', 'content-site-check', 'club-site-check', 'home-sections-check', 'consent-check', 'partners-button-check', 'theme-check', 'hero-video-check', 'hero-slides-check', 'mobile-forms-check', 'a11y-check'];
// the static checks that open a browser (the dashboard's sidebar and «السجل» pages, the emails' print layout): CI only
export const STATIC_BROWSER_CHECKS = ['admin-sidebar-check', 'admin-audit-check', 'email-print-check'];
// measured with the reader's system fonts (the emails name 'Segoe UI', Tahoma, Arial after IBM Plex Sans Arabic, which
// readers do not have): in CI on a Windows runner, as on the developer's machine — Linux has none of those fonts
export const CI_WINDOWS_CHECKS = ['email-print-check'];
// the local hooks (build and qa.py too, unless the commit is docs only): every static check that needs no browser
export const FAST_CHECKS = STATIC_CHECKS.filter((c) => !STATIC_BROWSER_CHECKS.includes(c));
// GitHub Actions: the browser checks in parallel jobs, balanced on the full-suite times of 8 Nov 2026 (about 5–6 min of
// checks each on this machine). Every browser check is in exactly one shard (asserted below), so a new check that is
// not placed fails every run instead of silently never running.
export const CI_SHARDS = {
  'booking-1': ['booking-nav-check', 'drawer-check', 'dining-site-check', 'gallery-site-check', 'blog-site-check', 'faq-site-check', 'content-site-check'],
  'booking-2': ['booking-whatsapp-check', 'datepicker-check'],
  'motion-offers': ['motion-check', 'booking-instant-check', 'offers-site-check'],
  'forms': ['partners-form-check', 'careers-form-check', 'club-site-check', 'consent-check', 'partners-button-check'],
  'home-phones': ['home-sections-check', 'theme-check', 'hero-video-check', 'hero-slides-check', 'mobile-forms-check'],
  'a11y': ['a11y-check'],
};
{
  const placed = Object.values(CI_SHARDS).flat();
  const missing = BROWSER_CHECKS.filter((c) => !placed.includes(c));
  const twice = placed.filter((c, i) => placed.indexOf(c) !== i);
  const unknown = placed.filter((c) => !BROWSER_CHECKS.includes(c));
  if (missing.length || twice.length || unknown.length) {
    throw new Error(`check-plan: CI_SHARDS out of step with BROWSER_CHECKS — missing ${missing.join(', ') || '—'}; twice ${twice.join(', ') || '—'}; unknown ${unknown.join(', ') || '—'}`);
  }
}
// a11y-check on sample pages for a content change: home, one branch, one room, offers, policies — both languages
const A11Y_SAMPLE = ['/', '/airport-road/', '/airport-road/one-bedroom-suite/', '/offers/', '/policies/'];
const BOOKING = ['booking-nav-check', 'drawer-check', 'booking-whatsapp-check', 'datepicker-check', 'booking-instant-check'];
const EMAIL = 'supabase/functions/booking-request/email.ts';
const RULES_TS = 'supabase/functions/booking-request/rules.ts';

const comp = (names) => new RegExp(`^src/components/(${names.join('|')})\\.astro$`);
const lib = (names) => new RegExp(`^src/lib/(${names.join('|')})\\.ts$`);
// shared by the three forms: the phone field and its libraries, the date field
const SHARED_FIELDS = [comp(['PhoneField', 'DateRangeField']), lib(['phone', 'country-select', 'countries', 'daterange']), new RegExp(`^${RULES_TS}$`)];

// a content file → pages it feeds beyond the sample (added to the a11y sample)
function contentPages(f) {
  const art = f.match(/^content\/articles\/([^/]+)\.(ar|en)\.md$/);
  if (art) return ['/blog/', `/blog/${art[1]}/`];
  if (f === 'content/careers.json') return ['/careers/'];
  if (f === 'content/taif-guide.json') return ['/discover-taif/'];
  if (/^content\/partners(-pages)?\.json$/.test(f)) return ['/partners/', '/partners/enquiry/'];
  if (f === 'content/branches.json') return ['/shafa-road/', '/contact/'];
  if (f === 'content/contact.json') return ['/contact/'];
  if (f === 'content/faq.json') return ['/faq/'];
  if (f === 'content/club.json') return ['/club/'];
  return [];
}

const RULES = [
  {
    name: 'docs',
    // Markdown outside the site's sources (CLAUDE.md, DECISIONS.md, docs/*.md, READMEs) and the committed reports —
    // nothing the build reads. Articles (content/articles/<slug>.<lang>.md) are content, not docs.
    test: (f) => /^reports\//.test(f) || (/\.md$/i.test(f) && !/^(src|public)\//.test(f) && !/^content\/articles\/[^/]+\.(ar|en)\.md$/.test(f)),
    docs: true,
  },
  {
    name: 'content',
    test: (f) => /^content\/[^/]+\.json$/.test(f) || /^content\/articles\/[^/]+\.(ar|en)\.md$/.test(f),
    a11y: 'sample',
    pages: contentPages,
  },
  {
    name: 'styles / motion / components',
    sampleQa: true,
    test: (f) => /^src\/(styles|components|layouts)\//.test(f) || lib(['reveal', 'counters', 'glow', 'carousel', 'story', 'roombar']).test(f),
    // the partners button lives in the header and motion.css (2 Nov 2026): its contrast, lift, sweep and focus ring
    checks: ['motion-check', 'partners-button-check', 'theme-check', 'hero-video-check', 'hero-slides-check', 'mobile-forms-check'],
    a11y: 'all',
    pixelGuard: true,
  },
  {
    name: 'booking form',
    test: (f) =>
      comp(['BookingForm', 'BookingDrawer', 'PriceBlock', 'WhatsAppButton']).test(f) ||
      lib(['drawer', 'prices']).test(f) ||
      f === 'src/styles/datepicker.css' ||
      /^src\/pages\/\[\.\.\.lang\]\/booking\//.test(f) ||
      SHARED_FIELDS.some((r) => r.test(f)),
    checks: BOOKING,
  },
  {
    name: 'partners form',
    test: (f) =>
      f === 'src/lib/partners-enquiry.ts' || f === 'src/styles/partners-phone.css' || f === 'src/pages/[...lang]/partners/enquiry.astro' || SHARED_FIELDS.some((r) => r.test(f)),
    checks: ['partners-form-check'],
  },
  {
    name: 'careers form',
    test: (f) => comp(['CareersForm', 'CountryField']).test(f) || f === 'src/pages/[...lang]/careers.astro' || SHARED_FIELDS.some((r) => r.test(f)),
    checks: ['careers-form-check'],
  },
  {
    // dining, the hall and the notify form (2 Nov 2026)
    name: 'dining / hall',
    test: (f) => comp(['VenueCards', 'NotifyForm', 'DiningSection']).test(f) || /^src\/pages\/\[\.\.\.lang\]\/(dining\/|\[branch\]\/hall\.astro$)/.test(f),
    checks: ['dining-site-check'],
  },
  {
    // the gallery page (2 Nov 2026): the page, its order / filters, the nav link it adds
    name: 'gallery',
    test: (f) =>
      f === 'src/pages/[...lang]/gallery.astro' || lib(['gallery', 'gallery-viewer', 'slider']).test(f) || comp(['Header', 'GalleryViewer', 'BranchPhotoStrip']).test(f) ||
      f === 'src/pages/[...lang]/[branch]/index.astro',
    checks: ['gallery-site-check'],
  },
  {
    // «العروض» (2 Nov 2026): /offers/, the cards and their placements, the announcement bar, the pop-up, the promo-code
    // field of the booking form
    name: 'offers',
    sampleQa: true,
    test: (f) =>
      comp(['OfferCard', 'OfferList', 'OffersSection', 'OfferBar', 'OfferPopup', 'Header', 'BookingForm']).test(f) ||
      lib(['offers', 'offers-data', 'popup', 'drawer', 'prices']).test(f) ||
      f === 'src/pages/[...lang]/offers.astro' ||
      f === 'src/layouts/Base.astro',
    checks: ['offers-site-check'],
  },
  {
    // «المدونة» on the site (3 Nov 2026): the list, the article page, the RSS feed, the article library and its
    // sanitiser, the card, the body; an article file of the seed
    name: 'blog',
    sampleQa: true,
    test: (f) =>
      /^src\/pages\/\[\.\.\.lang\]\/blog\//.test(f) || comp(['ArticleCard', 'ArticleBody']).test(f) || lib(['articles', 'blog-md']).test(f) ||
      /^content\/articles\/[^/]+\.(ar|en)\.md$/.test(f) || f === 'src/content.config.ts',
    checks: ['blog-site-check'],
  },
  {
    // «الأسئلة الشائعة» on the site (3 Nov 2026): the page, its data library, the seed / fallback file
    name: 'faq',
    test: (f) => f === 'src/pages/[...lang]/faq.astro' || lib(['faq']).test(f) || f === 'content/faq.json',
    checks: ['faq-site-check'],
  },
  {
    // «المحتوى والظهور» on the site (3 Nov 2026): the announcement bar, the links a hidden page must lose, the article
    // links to hidden pages; the sample manifest
    name: 'content & visibility',
    test: (f) =>
      comp(['OfferBar', 'OfferPopup', 'Header', 'Footer', 'ArticleBody', 'OffersSection']).test(f) || lib(['offers-data', 'articles', 'gallery']).test(f) ||
      f === 'scripts/fixtures/content-sample.json' || f === 'src/layouts/Base.astro',
    checks: ['content-site-check'],
  },
  {
    // session 5 (3 Nov 2026): the «فروعنا» header menu, «إياب» (/club/, the unsubscribe page, the form,
    // the footer link and the home band), the booking form's marketing box, the club copy and the privacy section
    name: 'club / header menu',
    test: (f) =>
      comp(['Header', 'Footer', 'ClubForm', 'BookingForm', 'BookingDrawer', 'PhoneField']).test(f) ||
      /^src\/pages\/\[\.\.\.lang\]\/(club\/|index\.astro$|booking\/)/.test(f) ||
      ['content/club.json', 'content/policies.json', 'content/ui.json', 'content/seo.json', 'content/branches.json', 'src/lib/content.ts', RULES_TS].includes(f),
    checks: ['club-site-check'],
  },
  {
    // the home sections (7 Nov 2026): the page, its section components, the data they read (rooms flagged for the home
    // page, the reviews and their build step, the copy), the footer «تابعنا» row
    name: 'home sections',
    sampleQa: true,
    test: (f) =>
      f === 'src/pages/[...lang]/index.astro' || /^src\/components\/home\//.test(f) || comp(['Footer', 'ArticleCard', 'Counters']).test(f) ||
      lib(['reviews', 'gallery', 'offers-data', 'slider', 'marquee']).test(f) || f === 'scripts/reviews-build.mjs' || f === 'scripts/partner-logos-build.mjs' ||
      f === 'scripts/fixtures/partner-logos-sample.json' || f === 'content/partner-logos.json' ||
      ['content/reviews.json', 'content/rooms.json', 'content/site-texts.json', 'content/ui.json', 'content/club.json', 'content/contact.json', 'content/taif-guide.json', 'src/lib/content.ts'].includes(f),
    checks: ['home-sections-check', 'motion-check'],
  },
  {
    // the cookie banner (7 Nov 2026): Consent Mode defaults in Base.astro, the banner, its script, the footer link, the
    // copy, the policy version; the pop-up waits for it
    name: 'cookie consent',
    test: (f) =>
      comp(['CookieConsent', 'Footer']).test(f) || lib(['consent', 'popup']).test(f) || f === 'src/layouts/Base.astro' ||
      ['content/ui.json', 'content/policies.json'].includes(f),
    checks: ['consent-check'],
  },
  {
    // the home hero (6 Nov 2026): the page and its script — the video, the slideshow, the pause control
    name: 'home hero',
    test: (f) => f === 'src/pages/[...lang]/index.astro',
    checks: ['hero-video-check', 'hero-slides-check', 'motion-check'],
  },
  {
    // forms on phones (6 Nov 2026): every field ≥ 16 px, the country picker inside 375 px, no Israel in the lists
    name: 'forms on phones',
    test: (f) => SHARED_FIELDS.some((r) => r.test(f)) || comp(['CountryField', 'ClubForm', 'NotifyForm', 'CareersForm', 'BookingForm']).test(f) || f === 'src/styles/partners-phone.css',
    checks: ['mobile-forms-check'],
  },
  {
    name: 'email.ts',
    test: (f) => f === EMAIL,
    checks: ['email-print-check', 'auth-emails-check', 'whatsapp-check', 'offers-engine-check'],
  },
];

const both = (paths) => paths.flatMap((p) => [p, p === '/' ? '/en/' : `/en${p}`]);

/** The checks for a set of repo-relative paths: { full, build, checks (suite order, build/qa excluded), a11yPages
 *  (null = every page), pixelGuard, files: [{ file, rules }], unmapped }. */
export function planFor(files, { invisible = false } = {}) {
  const rows = files.map((file) => ({ file, rules: RULES.filter((r) => r.test(file)) }));
  const unmapped = rows.filter((r) => !r.rules.length).map((r) => r.file);
  const all = rows.flatMap((r) => r.rules);
  const docsOnly = files.length > 0 && rows.every((r) => r.rules.length && r.rules.every((x) => x.docs));
  const files_ = rows.map((r) => ({ file: r.file, rules: r.rules.length ? r.rules.map((x) => x.name) : ['— unmapped → full suite'] }));
  if (unmapped.length) {
    return { full: true, build: true, sampleQa: true, checks: [...STATIC_CHECKS, ...BROWSER_CHECKS], a11yPages: null, pixelGuard: invisible, files: files_, unmapped };
  }
  const extra = new Set(all.flatMap((r) => r.checks ?? []));
  const a11yAll = all.some((r) => r.a11y === 'all');
  const sample = all.some((r) => r.a11y === 'sample');
  if (a11yAll || sample) extra.add('a11y-check');
  const pages = new Set(A11Y_SAMPLE);
  for (const r of rows) for (const x of r.rules) for (const p of x.pages?.(r.file) ?? []) pages.add(p);
  const wanted = new Set([...FAST_CHECKS, ...extra]);
  return {
    full: false,
    build: !docsOnly,
    checks: [...STATIC_CHECKS, ...BROWSER_CHECKS].filter((c) => wanted.has(c)),
    a11yPages: a11yAll ? null : sample ? both([...pages]) : null,
    pixelGuard: invisible && !docsOnly,
    sampleQa: !docsOnly && all.some((r) => r.sampleQa),
    files: files_,
    unmapped,
  };
}

/** The local hooks' plan (9 Nov 2026): build + qa + FAST_CHECKS — no browser; a docs-only change skips the build. */
export function fastPlan(files) {
  const docsOnly = files.length > 0 && files.every((f) => RULES.find((r) => r.name === 'docs').test(f));
  return { full: false, fast: true, build: !docsOnly, checks: [...FAST_CHECKS], a11yPages: null, pixelGuard: false, sampleQa: false, files: files.map((file) => ({ file, rules: ['fast'] })), unmapped: [] };
}

export function stagedFiles(cwd = process.cwd()) {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** One line per check, for the hook's log and the dry-run. */
export function describe(plan) {
  const list = [...(plan.build ? ['build', 'qa'] : []), ...plan.checks.map((c) => (c === 'a11y-check' && plan.a11yPages ? `a11y-check (${plan.a11yPages.length} sample pages)` : c))];
  if (plan.sampleQa) list.push('sample qa (the dashboard samples built, then qa.py)');
  if (plan.pixelGuard) list.push('pixel-guard (HEAD → staged)');
  return `${plan.full ? 'FULL SUITE' : plan.fast ? 'fast (no browser)' : 'routed'}: ${list.join(', ')}`;
}

const SAMPLES = [
  ['docs edit', ['DECISIONS.md']],
  ['content edit', ['content/policies.json']],
  ['CSS edit', ['src/styles/global.css']],
  ['CSS edit, ARMADA_INVISIBLE=1', ['src/styles/global.css'], { invisible: true }],
  ['booking-form edit', ['src/components/BookingForm.astro']],
  ['shared phone field', ['src/lib/phone.ts']],
  ['partners form', ['src/lib/partners-enquiry.ts']],
  ['careers form', ['src/components/CareersForm.astro']],
  ['email.ts', [EMAIL]],
  ['article edit', ['content/articles/taif-rose-season.en.md']],
  ['content + docs', ['content/ui.json', 'CLAUDE.md']],
  ['unmapped file', ['build.py']],
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const invisible = process.env.ARMADA_INVISIBLE === '1';
  if (args.includes('--shards-json')) {
    // deploy.yml's matrix (the build job's `shards` output)
    // --live: live-checks.yml's matrix — the same shards against the live site, plus `cors` (the CORS checks)
    console.log(JSON.stringify([...Object.keys(CI_SHARDS), ...(args.includes('--live') ? ['cors'] : [])]));
  } else if (args.includes('--shards')) {
    for (const [name, checks] of Object.entries(CI_SHARDS)) console.log(`${name}: ${checks.join(', ')}`);
    console.log(`static (CI): build, qa, ${STATIC_CHECKS.filter((c) => !CI_WINDOWS_CHECKS.includes(c)).join(', ')}, sample qa`);
    console.log(`windows (CI): ${CI_WINDOWS_CHECKS.join(', ')}`);
    console.log(`local hooks: build, qa, ${FAST_CHECKS.join(', ')}`);
  } else if (args.includes('--dry-run')) {
    console.log('| sample change | files | checks |\n|---|---|---|');
    for (const [label, files, opts] of SAMPLES) console.log(`| ${label} | ${files.join(', ')} | ${describe(planFor(files, opts))} |`);
  } else {
    const files = args.includes('--staged') ? stagedFiles() : args.filter((a) => !a.startsWith('--'));
    const plan = planFor(files, { invisible });
    for (const r of plan.files) console.log(`  ${r.file}  →  ${r.rules.join(' + ')}`);
    console.log(describe(plan));
  }
}
