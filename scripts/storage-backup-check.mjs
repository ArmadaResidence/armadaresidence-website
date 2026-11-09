#!/usr/bin/env node
// Offline check of the weekly Storage → R2 backup (9 Nov 2026): the sync plan (new / unchanged / replaced / removed /
// unknown → HEAD), the 90-day retention of deleted/<date>/, the after-run check (keys, sizes, count, total), the
// Riyadh date, the excluded bucket, and the workflow's wiring (schedule Friday 03:00 Riyadh = 00:00 UTC, manual
// dispatch, the three R2 secrets and the service key by name only, the alert on failure). Nothing reaches a network.
//   node scripts/storage-backup-check.mjs
import { readFileSync } from 'node:fs';
import { EXCLUDED, expired, plan, riyadhDate, verify } from './storage-backup.mjs';

let n = 0;
const fails = [];
const E = (label, ok) => {
  n++;
  if (!ok) fails.push(label);
};

const S = (key, size, etag) => ({ key, size, etag });
const storage = [S('media-originals/a.jpg', 10, 'aa'), S('media-originals/b.jpg', 20, 'bb'), S('media-originals/c.jpg', 30, 'cc'), S('partner-quotes/q.pdf', 5, 'qq'), S('media-originals/e.jpg', 7, 'ee')];
const r2 = new Map([['media-originals/a.jpg', { size: 10 }], ['media-originals/b.jpg', { size: 21 }], ['media-originals/c.jpg', { size: 30 }], ['media-originals/gone.jpg', { size: 3 }], ['media-originals/e.jpg', { size: 7 }]]);
const manifest = { 'media-originals/a.jpg': { etag: '"aa"', size: 10 }, 'media-originals/b.jpg': { etag: 'bb', size: 21 }, 'media-originals/c.jpg': { etag: 'old', size: 30 } };
const p = plan(storage, r2, manifest);
E('plan: a file the manifest knows with the same size and eTag is unchanged (quotes ignored)', p.unchanged === 1);
E('plan: a new file is uploaded', JSON.stringify(p.upload) === '["partner-quotes/q.pdf"]');
E('plan: a size change is a replace (old copy to deleted/ first)', p.replace.includes('media-originals/b.jpg'));
E('plan: an eTag change at the same size is a replace', p.replace.includes('media-originals/c.jpg'));
E('plan: a file gone from Storage is removed (to deleted/ first)', JSON.stringify(p.remove) === '["media-originals/gone.jpg"]');
E('plan: same size but unknown to the manifest → HEAD first', JSON.stringify(p.unknown) === '["media-originals/e.jpg"]');
const p2 = plan(storage, r2, manifest, new Map([['media-originals/e.jpg', 'ee']]));
E('plan: after HEAD, a matching src-etag is unchanged', p2.unchanged === 2 && !p2.unknown.length && !p2.replace.includes('media-originals/e.jpg'));
const p3 = plan(storage, r2, manifest, new Map([['media-originals/e.jpg', 'zz']]));
E('plan: after HEAD, a different src-etag is a replace', p3.replace.includes('media-originals/e.jpg'));
const p4 = plan(storage, r2, manifest, new Map([['media-originals/e.jpg', '']]));
E('plan: no src-etag on the R2 copy (and none to compare) is a replace, never a silent skip', p4.replace.includes('media-originals/e.jpg'));
E('plan: an empty R2 uploads everything', plan(storage, new Map(), {}).upload.length === storage.length);

const keys = ['deleted/2026-08-10/media-originals/x.jpg', 'deleted/2026-08-11/media-originals/y.jpg', 'deleted/2026-11-01/partner-quotes/z.pdf', 'current/media-originals/a.jpg', 'manifest/current.json'];
E('retention: older than 90 days removed, the 90th day kept, current/ and the manifest never', JSON.stringify(expired(keys, '2026-11-09')) === '["deleted/2026-08-10/media-originals/x.jpg"]');

const ok = verify(storage, new Map(storage.map((o) => [o.key, { size: o.size }])));
E('verify: identical → ok with counts and total', ok.ok && ok.counts.storage_files === 5 && ok.counts.r2_bytes === 72 && ok.counts.storage_bytes === 72);
const bad = verify(storage, new Map([...storage.slice(1).map((o) => [o.key, { size: o.size }]), ['x/extra', { size: 10 }]]));
E('verify: a missing file and an extra one of the same size still fail (keys, not only totals)', !bad.ok && bad.missing === 1 && bad.extra === 1);
const sz = verify(storage, new Map(storage.map((o, i) => [o.key, { size: o.size + (i === 0 ? 1 : 0) }])));
E('verify: a size difference fails', !sz.ok && sz.size_mismatch === 1);

E('riyadhDate: 21:30 UTC is the next Riyadh day', riyadhDate(new Date('2026-11-12T21:30:00Z')) === '2026-11-13');
E('excluded: job-applications only (transient CVs, CLAUDE.md §8b)', EXCLUDED.size === 1 && EXCLUDED.has('job-applications'));

// the workflow
const wf = readFileSync('.github/workflows/storage-backup.yml', 'utf8');
E('workflow: Friday 00:00 UTC = 03:00 Riyadh', /cron:\s*'0 0 \* \* 5'/.test(wf));
E('workflow: manual dispatch', /workflow_dispatch:/.test(wf));
for (const s of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) E(`workflow: ${s} from secrets`, new RegExp(`${s}: \\$\\{\\{ secrets\\.${s} \\}\\}`).test(wf));
E('workflow: the R2 bucket armada-storage-backup', /R2_BUCKET: armada-storage-backup/.test(wf));
E('workflow: never echoes a secret', !/echo[^\n]*secrets\./.test(wf) && !/set -x/.test(wf));
E('workflow: the alert runs on failure through site-deploy-report backup', /if: \$\{\{ failure\(\) \}\}/.test(wf) && /site-deploy-report\.mjs backup/.test(wf));
E('workflow: one run at a time', /concurrency:/.test(wf));

if (fails.length) {
  console.error(`storage-backup-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`storage-backup-check: ${n} checks passed`);
