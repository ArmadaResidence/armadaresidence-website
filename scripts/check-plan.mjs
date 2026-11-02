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
export const STATIC_CHECKS = ['typecheck', 'admin-digits-check', 'admin-format-check', 'auth-emails-check', 'whatsapp-check', 'email-print-check'];
export const BROWSER_CHECKS = ['booking-nav-check', 'drawer-check', 'booking-whatsapp-check', 'datepicker-check', 'motion-check', 'booking-instant-check', 'partners-form-check', 'careers-form-check', 'dining-site-check', 'gallery-site-check', 'a11y-check'];
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
    checks: ['motion-check'],
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
    name: 'email.ts',
    test: (f) => f === EMAIL,
    checks: ['email-print-check', 'auth-emails-check', 'whatsapp-check'],
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
