// Which checks a commit runs (CLAUDE.md §11 — routed pre-commit, full suite before push; Ahmed, 31 Oct 2026).
// The pre-commit (node scripts/check-all.mjs --staged) runs the fast checks on every commit and adds only the checks
// mapped to the staged files; the pre-push hook runs the whole suite on the commit being pushed.
//   node scripts/check-plan.mjs <file> [<file> …]   the plan for these paths (repo-relative)
//   node scripts/check-plan.mjs --staged            the plan for what is staged now
//   node scripts/check-plan.mjs --dry-run           the plan for one sample change of each kind (proof of the routing)
// Rules: a file may match several rules (their checks add up); a file that matches no rule runs the full suite; a
// commit made only of docs skips the build (and qa.py, which reads dist/). When in doubt the rule runs more, never less.
// ARMADA_INVISIBLE=1 in the environment of `git commit` adds the pixel guard (HEAD's build against the staged one):
// for a change to styles, motion or components that must not change what a visitor sees.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// the suite, in the order check-all runs it
export const STATIC_CHECKS = ['typecheck', 'admin-digits-check', 'admin-format-check', 'auth-emails-check', 'whatsapp-check', 'email-print-check', 'offers-engine-check', 'turnstile-check'];
export const BROWSER_CHECKS = ['booking-nav-check', 'drawer-check', 'booking-whatsapp-check', 'datepicker-check', 'motion-check', 'booking-instant-check', 'partners-form-check', 'careers-form-check', 'dining-site-check', 'gallery-site-check', 'offers-site-check', 'blog-site-check', 'faq-site-check', 'content-site-check', 'club-site-check', 'partners-button-check', 'theme-check', 'hero-video-check', 'a11y-check'];
// every commit (build and qa.py too, unless the commit is docs only)
export const FAST_CHECKS = ['typecheck', 'admin-digits-check', 'admin-format-check', 'auth-emails-check', 'whatsapp-check'];
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
    test: (f) => /^src\/(styles|components|layouts)\//.test(f) || lib(['reveal', 'counters', 'glow', 'carousel', 'story', 'roombar']).test(f),
    // the partners button lives in the header and motion.css (2 Nov 2026): its contrast, lift, sweep and focus ring
    checks: ['motion-check', 'partners-button-check', 'theme-check', 'hero-video-check'],
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
    test: (f) => f === 'src/pages/[...lang]/gallery.astro' || f === 'src/lib/gallery.ts' || comp(['Header']).test(f),
    checks: ['gallery-site-check'],
  },
  {
    // «العروض» (2 Nov 2026): /offers/, the cards and their placements, the announcement bar, the pop-up, the promo-code
    // field of the booking form
    name: 'offers',
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
    // session 5 (3 Nov 2026): the «فروعنا» header menu, «نادي أرمادا ريزيدنس» (/club/, the unsubscribe page, the form,
    // the footer link and the home band), the booking form's marketing box, the club copy and the privacy section
    name: 'club / header menu',
    test: (f) =>
      comp(['Header', 'Footer', 'ClubForm', 'BookingForm', 'BookingDrawer', 'PhoneField']).test(f) ||
      /^src\/pages\/\[\.\.\.lang\]\/(club\/|index\.astro$|booking\/)/.test(f) ||
      ['content/club.json', 'content/policies.json', 'content/ui.json', 'content/seo.json', 'content/branches.json', 'src/lib/content.ts', RULES_TS].includes(f),
    checks: ['club-site-check'],
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
    return { full: true, build: true, checks: [...STATIC_CHECKS, ...BROWSER_CHECKS], a11yPages: null, pixelGuard: invisible, files: files_, unmapped };
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
    files: files_,
    unmapped,
  };
}

export function stagedFiles(cwd = process.cwd()) {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** One line per check, for the hook's log and the dry-run. */
export function describe(plan) {
  const list = [...(plan.build ? ['build', 'qa'] : []), ...plan.checks.map((c) => (c === 'a11y-check' && plan.a11yPages ? `a11y-check (${plan.a11yPages.length} sample pages)` : c))];
  if (plan.pixelGuard) list.push('pixel-guard (HEAD → staged)');
  return `${plan.full ? 'FULL SUITE' : 'routed'}: ${list.join(', ')}`;
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
  if (args.includes('--dry-run')) {
    console.log('| sample change | files | checks |\n|---|---|---|');
    for (const [label, files, opts] of SAMPLES) console.log(`| ${label} | ${files.join(', ')} | ${describe(planFor(files, opts))} |`);
  } else {
    const files = args.includes('--staged') ? stagedFiles() : args.filter((a) => !a.startsWith('--'));
    const plan = planFor(files, { invisible });
    for (const r of plan.files) console.log(`  ${r.file}  →  ${r.rules.join(' + ')}`);
    console.log(describe(plan));
  }
}
