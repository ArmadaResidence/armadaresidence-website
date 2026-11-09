#!/usr/bin/env node
// Weekly backup of Supabase Storage to Cloudflare R2 (Ahmed, 9 Nov 2026 — DECISIONS.md 2026-11-09 «Weekly Storage
// backup to R2»; restore steps: docs/backup-restore.md). Run by .github/workflows/storage-backup.yml every Friday
// 03:00 Asia/Riyadh and by hand (workflow_dispatch).
//
// What it does, per Storage bucket (every bucket the project has, except EXCLUDED below):
//   - current/<bucket>/<path> in the R2 bucket mirrors the Storage object. Incremental: a file is uploaded only when it
//     is new or changed (size or Storage eTag differ — the eTag is kept as the R2 object's metadata `src-etag` and in
//     the run manifest manifest/current.json, so unchanged files cost one listing, no download).
//   - a file replaced in Storage: its previous copy is first moved to deleted/<YYYY-MM-DD>/<bucket>/<path> (the run's
//     Riyadh date), then the new one is uploaded; a file deleted in Storage: its copy is moved there too. Nothing that
//     was backed up is lost at once.
//   - deleted/<date>/… older than RETENTION_DAYS (90) is removed.
//   - then the check: the files and their sizes under current/ (listed again from R2) must equal Storage's — the same
//     keys, the same sizes, the same count and total. Any difference fails the run (exit 1).
// Writes a short summary to the run log ($GITHUB_STEP_SUMMARY) and backup-result.json (status, reason, counts — never a
// file name) for the alert step. Never prints a credential.
//
// Env: SUPABASE_URL (else the origin of PUBLIC_BOOKING_ENDPOINT), SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default armada-storage-backup), BACKUP_DRY_RUN=1 (plan only:
//   nothing written to R2). Needs @aws-sdk/client-s3 (installed by the workflow, not a project dependency).
import { createWriteStream, createReadStream, mkdtempSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

export const RETENTION_DAYS = 90;
/** job-applications: transient by design — a CV is deleted from Storage the moment its email is accepted (CLAUDE.md
 *  §8b) and the jobs mailbox is the record; a backup copy would outlive that promise (DECISIONS.md 2026-11-09) */
export const EXCLUDED = new Set(['job-applications']);
const CONCURRENCY = 4;

/** the Riyadh calendar date of an instant, YYYY-MM-DD */
export function riyadhDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const clean = (etag) => String(etag ?? '').replace(/^W\//, '').replace(/"/g, '').toLowerCase();

/**
 * The plan of one run (pure — scripts/storage-backup-check.mjs tests it).
 * storage: [{ key: '<bucket>/<path>', size, etag }] · r2: Map key → { size } (current/ without the prefix) ·
 * manifest: { key: { etag, size } } · heads: Map key → src-etag read from R2 for keys the manifest does not know.
 * → { upload: [key], replace: [key] (copy to deleted/, then upload), remove: [key] (copy to deleted/, then delete),
 *     unknown: [key] (present in R2 with the same size but not in the manifest: HEAD needed first), unchanged: n }
 */
export function plan(storage, r2, manifest, heads = new Map()) {
  const out = { upload: [], replace: [], remove: [], unknown: [], unchanged: 0 };
  const seen = new Set();
  for (const o of storage) {
    seen.add(o.key);
    const have = r2.get(o.key);
    if (!have) {
      out.upload.push(o.key);
      continue;
    }
    const etag = clean(o.etag);
    const known = manifest[o.key];
    if (have.size === o.size && known && known.size === o.size && clean(known.etag) === etag) {
      out.unchanged++;
      continue;
    }
    if (have.size === o.size && !known) {
      if (!heads.has(o.key)) {
        out.unknown.push(o.key);
        continue;
      }
      if (clean(heads.get(o.key)) === etag && etag) {
        out.unchanged++;
        continue;
      }
    }
    out.replace.push(o.key);
  }
  for (const k of r2.keys()) if (!seen.has(k)) out.remove.push(k);
  return out;
}

/** the deleted/<date>/ keys past retention (their date older than `days` before `today`) */
export function expired(keys, today, days = RETENTION_DAYS) {
  const limit = Date.parse(`${today}T00:00:00Z`) - days * 86400000;
  return keys.filter((k) => {
    const m = /^deleted\/(\d{4}-\d{2}-\d{2})\//.exec(k);
    return m && Date.parse(`${m[1]}T00:00:00Z`) < limit;
  });
}

/** the check after the run: R2 current/ = Storage (keys, sizes, count, total) */
export function verify(storage, r2) {
  const problems = [];
  let size = 0;
  for (const o of storage) {
    size += o.size;
    const h = r2.get(o.key);
    if (!h) problems.push('missing');
    else if (h.size !== o.size) problems.push('size');
  }
  let r2size = 0;
  const keys = new Set(storage.map((o) => o.key));
  for (const [k, v] of r2) {
    r2size += v.size;
    if (!keys.has(k)) problems.push('extra');
  }
  const counts = { storage_files: storage.length, storage_bytes: size, r2_files: r2.size, r2_bytes: r2size };
  const ok = problems.length === 0 && counts.storage_files === counts.r2_files && counts.storage_bytes === counts.r2_bytes;
  return { ok, counts, missing: problems.filter((p) => p === 'missing').length, size_mismatch: problems.filter((p) => p === 'size').length, extra: problems.filter((p) => p === 'extra').length };
}

export const human = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

// ───────────────────────────── the run ─────────────────────────────

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function storageApi(base, key) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  return {
    async buckets() {
      const r = await fetch(`${base}/storage/v1/bucket`, { headers: h });
      if (!r.ok) throw new Error(`storage buckets: HTTP ${r.status}`);
      return (await r.json()).map((b) => b.id ?? b.name);
    },
    /** every object of a bucket, walking its folders */
    async list(bucket) {
      const out = [];
      const walk = async (prefix) => {
        for (let offset = 0; ; offset += 1000) {
          const r = await fetch(`${base}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
            method: 'POST',
            headers: { ...h, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
          });
          if (!r.ok) throw new Error(`storage list ${bucket}: HTTP ${r.status}`);
          const items = await r.json();
          for (const it of items) {
            const path = prefix ? `${prefix}/${it.name}` : it.name;
            if (it.id === null || !it.metadata) await walk(path); // a folder
            else out.push({ key: `${bucket}/${path}`, bucket, path, size: Number(it.metadata.size ?? it.metadata.contentLength ?? 0), etag: clean(it.metadata.eTag), type: it.metadata.mimetype || 'application/octet-stream', updated: it.updated_at });
          }
          if (items.length < 1000) break;
        }
      };
      await walk('');
      return out;
    },
    async download(bucket, path, file) {
      const r = await fetch(`${base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${enc(path)}`, { headers: h });
      if (!r.ok || !r.body) throw new Error(`storage download: HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
    },
  };
}

async function main() {
  const t0 = Date.now();
  const env = process.env;
  const dry = env.BACKUP_DRY_RUN === '1';
  const base = (env.SUPABASE_URL || (env.PUBLIC_BOOKING_ENDPOINT || '').split('/functions/')[0]).replace(/\/$/, '');
  const result = { status: 'failed', reason: 'failed', dry_run: dry, counts: null, stats: null, seconds: 0 };
  const summary = (lines) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  };
  const finish = (code) => {
    result.seconds = Math.round((Date.now() - t0) / 1000);
    writeFileSync('backup-result.json', JSON.stringify(result, null, 2));
    process.exitCode = code;
  };
  const need = ['SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
  if (!base || need.length) {
    console.error(`storage-backup: missing ${[!base && 'SUPABASE_URL', ...need].filter(Boolean).join(', ')}`);
    result.reason = 'config';
    return finish(1);
  }
  const { S3Client, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const Bucket = env.R2_BUCKET || 'armada-storage-backup';
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
  const st = storageApi(base, env.SUPABASE_SERVICE_ROLE_KEY);
  const today = riyadhDate();
  const tmp = mkdtempSync(join(tmpdir(), 'armada-backup-'));
  const stats = { uploaded: 0, uploaded_bytes: 0, replaced: 0, moved_to_deleted: 0, purged: 0, unchanged: 0, buckets: [] };
  try {
    const listR2 = async (prefix) => {
      const m = new Map();
      let token;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
        for (const o of r.Contents ?? []) m.set(o.Key.slice(prefix.length), { size: Number(o.Size ?? 0) });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return m;
    };
    // 1. Storage
    const buckets = (await st.buckets()).filter((b) => !EXCLUDED.has(b)).sort();
    const storage = [];
    for (const b of buckets) {
      const objs = await st.list(b);
      storage.push(...objs);
      stats.buckets.push({ bucket: b, files: objs.length, bytes: objs.reduce((a, o) => a + o.size, 0) });
    }
    const byKey = new Map(storage.map((o) => [o.key, o]));
    // 2. R2 current/ and the manifest
    const r2 = await listR2('current/');
    let manifest = {};
    try {
      const g = await s3.send(new GetObjectCommand({ Bucket, Key: 'manifest/current.json' }));
      manifest = JSON.parse(await g.Body.transformToString()).objects ?? {};
    } catch {
      manifest = {};
    }
    // keys the manifest does not know but R2 holds with the same size: their src-etag from the object itself
    let p = plan(storage, r2, manifest);
    const heads = new Map();
    await pool(p.unknown, 8, async (k) => {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket, Key: `current/${k}` }));
        heads.set(k, h.Metadata?.['src-etag'] ?? '');
      } catch {
        heads.set(k, '');
      }
    });
    if (p.unknown.length) p = plan(storage, r2, manifest, heads);
    stats.unchanged = p.unchanged;
    console.log(`storage-backup: ${storage.length} files in Storage (${buckets.length} buckets), ${r2.size} in R2 current/ — upload ${p.upload.length}, replace ${p.replace.length}, remove ${p.remove.length}, unchanged ${p.unchanged}${dry ? ' (DRY RUN)' : ''}`);

    const copySource = (key) => `${Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const toDeleted = async (k) => {
      await s3.send(new CopyObjectCommand({ Bucket, Key: `deleted/${today}/${k}`, CopySource: copySource(`current/${k}`), MetadataDirective: 'COPY' }));
      stats.moved_to_deleted++;
    };
    const put = async (k) => {
      const o = byKey.get(k);
      const file = join(tmp, String(Math.random()).slice(2));
      await st.download(o.bucket, o.path, file);
      const size = statSync(file).size;
      if (size !== o.size) throw new Error(`download size differs (${size} ≠ ${o.size})`);
      await s3.send(new PutObjectCommand({ Bucket, Key: `current/${k}`, Body: createReadStream(file), ContentLength: size, ContentType: o.type, Metadata: { 'src-etag': o.etag, 'src-updated': String(o.updated ?? '') } }));
      rmSync(file, { force: true });
      stats.uploaded++;
      stats.uploaded_bytes += size;
    };
    const del = async (keys) => {
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        const r = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
        if (r.Errors?.length) throw new Error(`R2 delete: ${r.Errors.length} failed`);
      }
    };

    if (!dry) {
      // 3. new files; replaced files (the old copy to deleted/ first); files gone from Storage (to deleted/, then off current/)
      await pool(p.upload, CONCURRENCY, put);
      await pool(p.replace, CONCURRENCY, async (k) => {
        await toDeleted(k);
        await put(k);
        stats.replaced++;
      });
      await pool(p.remove, CONCURRENCY, toDeleted);
      await del(p.remove.map((k) => `current/${k}`));
      // 4. the manifest of what current/ now holds
      const objects = {};
      for (const o of storage) objects[o.key] = { etag: o.etag, size: o.size };
      await s3.send(new PutObjectCommand({ Bucket, Key: 'manifest/current.json', Body: JSON.stringify({ version: 1, updated_at: new Date().toISOString(), date: today, objects }), ContentType: 'application/json' }));
      // 5. retention: deleted/<date>/ older than 90 days
      const old = expired([...(await listR2('')).keys()].filter((k) => k.startsWith('deleted/')), today);
      await del(old);
      stats.purged = old.length;
    }

    // 6. the check: R2 current/ listed again = Storage
    const after = dry ? r2 : await listR2('current/');
    const v = verify(storage, after);
    result.counts = v.counts;
    result.stats = stats;
    const secs = Math.round((Date.now() - t0) / 1000);
    const lines = [
      `## Storage → R2 backup${dry ? ' (dry run)' : ''} — ${today}`,
      '',
      `| | files | size |`,
      `|---|---:|---:|`,
      `| Supabase Storage | ${v.counts.storage_files} | ${human(v.counts.storage_bytes)} |`,
      `| R2 current/ | ${v.counts.r2_files} | ${human(v.counts.r2_bytes)} |`,
      '',
      `- buckets: ${stats.buckets.map((b) => `${b.bucket} ${b.files} (${human(b.bytes)})`).join(' · ')}${EXCLUDED.size ? ` — excluded: ${[...EXCLUDED].join(', ')}` : ''}`,
      `- this run: uploaded ${stats.uploaded} (${human(stats.uploaded_bytes)}), of which replaced ${stats.replaced}; moved to deleted/ ${stats.moved_to_deleted}; purged (> ${RETENTION_DAYS} days) ${stats.purged}; unchanged ${stats.unchanged}`,
      `- time: ${secs} s`,
      `- check: ${v.ok ? 'OK — R2 current/ matches Storage (keys, sizes, count, total)' : `MISMATCH — missing ${v.missing}, size differs ${v.size_mismatch}, extra ${v.extra}`}`,
    ];
    console.log(lines.join('\n'));
    summary(lines);
    if (!v.ok && !dry) {
      result.reason = 'mismatch';
      return finish(1);
    }
    result.status = 'ok';
    result.reason = '';
    return finish(0);
  } catch (e) {
    // the message names a step and an HTTP status, never a credential or a file name
    console.error(`storage-backup: failed — ${String(e?.message ?? e).slice(0, 300)}`);
    result.stats = stats;
    summary([`## Storage → R2 backup — FAILED`, '', `- ${String(e?.message ?? e).slice(0, 300)}`]);
    return finish(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
