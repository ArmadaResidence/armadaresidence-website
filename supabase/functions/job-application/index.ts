// Supabase Edge Function: job-application (careers page «انضم إلى فريقنا», Ahmed 28 Oct 2026 — DECISIONS.md 2026-10-28)
//
// POST multipart/form-data from /careers/ (src/components/CareersForm.astro). Order:
//   1. honeypot `website` filled → 200 with a ref, nothing stored or sent; per-IP limit (IP_LIMIT per hour, 429);
//   2. validate with rules.ts → validateJobApplication — the SAME rules the form runs; the server never trusts the
//      client: the file must START with the PDF signature (the name and the browser's type are ignored), be ≤ 5 MB and
//      be one file (422 with the field codes);
//   3. at most QUOTA applications per email or per phone in 24 hours (salted hashes; 429 'quota');
//   4. the CV goes to the private bucket job-applications as «CV-{ref}.pdf», then the row (public.submit_job_application
//      — the quota is re-checked under a lock in the same transaction); ref = the booking requests' generator (AR-…);
//   5. ONE email to the careers recipients (booking_notification_recipients scope 'careers' — the jobs mailbox; no
//      active row → the central recipients, never nobody): From no-reply@, Reply-To = the applicant, the CV attached,
//      the shared layout with the internal print stylesheet; and the applicant's confirmation (Arabic then English, no
//      promise, Reply-To = the careers recipients, no attachment);
//   6. Resend accepted the jobs email → the file is deleted and every personal field nulled (job_application_result).
//      Otherwise the failure is logged with the ref (never silent) and the sweep retries.
// Sweep (POST {"action":"sweep"} with header x-armada-sweep = the Vault secret job_sweep_token, checked by the RPC
// public.job_sweep_check; pg_cron every 15 minutes through
// public.job_applications_kick): the 7-day purge (also run hourly in SQL by pg_cron), the retries, the deletion of files whose
// application is done, and an alert to the dashboard admins (users:edit) for each application dropped unsent.
// Test mode (x-armada-test = BOOKING_TEST_TOKEN): rows is_test, every email to Resend's sink, no per-IP limit (unless
// x-armada-test-limits: ip, which applies it on a test-only key); QA actions (JSON body, test token only): 'job-state'
// (one test ref: status, whether the personal fields are null and the file is gone — never the data itself) and
// 'job-cleanup' (deletes the test rows, their hits and files), 'job-age' (moves a test row's created_at /
// last_attempt_at into the past, so the sweep's retry and 7-day purge can be exercised now) and 'job-sweep' (runs the
// sweep at once, as pg_cron does). Test hooks on a submission (header x-armada-test-fail, test mode only): 'jobs' —
// the jobs email counts as not accepted (nothing is sent, the row stays failed with its file); 'delete' — the file
// is not deleted after the accepted send (an orphan for the sweep). The email / phone quota applies in test mode too.
// Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY (automatic), BOOKING_ALLOWED_ORIGINS, BOOKING_IP_SALT,
//   BOOKING_TEST_TOKEN. The sweep token and URL live in Supabase Vault only.
// Deployed with verify_jwt = false (supabase/config.toml): a public form endpoint; CORS limits the origins.
import { getCountries, parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.12.10/min';
import { siteOrigins } from '../_shared/site-cors.ts';
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { EMAIL, riyadhToday, validateJobApplication, type JobFile } from '../booking-request/rules.ts';
import { jobApplicationAlert, jobApplicationConfirmation, jobApplicationNotification, type JobMail, type Mail } from '../booking-request/email.ts';
import { makeRef } from '../_shared/ref.ts';

const IP_LIMIT = 5;
const IP_WINDOW_SECONDS = 3600;
const QUOTA = 3;
const BUCKET = 'job-applications';
const TEST_SINK = 'delivered@resend.dev';
const FROM_JOBS = Deno.env.get('BOOKING_FROM_RECEPTION') ?? 'Armada Residence Bookings <no-reply@armadaresidence.com>';
const FROM_APPLICANT = 'أرمادا ريزيدنس | Armada Residence <no-reply@armadaresidence.com>';
const KNOWN_BRANCHES: string[] = content.branches.map((b: { slug: string }) => b.slug);

const allowedOrigins = siteOrigins;
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-armada-test, x-armada-test-limits, x-armada-test-fail',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

const latinDigits = (s: string) => String(s ?? '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
function phoneE164(raw: string, country: string): string | null {
  const v = latinDigits(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
  if (!v) return null;
  try {
    const n = v.startsWith('+') ? parsePhoneNumberFromString(v) : parsePhoneNumberFromString(v, (country || 'SA') as never);
    return n && n.isValid() ? n.number : null;
  } catch {
    return null;
  }
}
const COUNTRIES = getCountries() as string[];

/** "2026-10-28 14:05 (Asia/Riyadh)" */
function riyadhStamp(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')} (Asia/Riyadh)`;
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const testMode = (req: Request) => sameSecret(req.headers.get('x-armada-test') ?? '', Deno.env.get('BOOKING_TEST_TOKEN') ?? '');

async function sha(s: string): Promise<string> {
  const salt = Deno.env.get('BOOKING_IP_SALT') ?? 'armada-booking';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${s}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
function clientIp(req: Request): string {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

function env(): { url: string; key: string } {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  return { url, key };
}
const H = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const e = env();
  const res = await fetch(`${e.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: H(e.key, { 'Content-Type': 'application/json' }), body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${name} ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const filePath = (ref: string) => `CV-${ref}.pdf`;
async function upload(ref: string, bytes: Uint8Array): Promise<boolean> {
  const e = env();
  const res = await fetch(`${e.url}/storage/v1/object/${BUCKET}/${filePath(ref)}`, { method: 'POST', headers: H(e.key, { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }), body: bytes });
  if (!res.ok) console.error('cv upload failed', ref, res.status, (await res.text()).slice(0, 200));
  return res.ok;
}
async function download(ref: string): Promise<Uint8Array | null> {
  const e = env();
  const res = await fetch(`${e.url}/storage/v1/object/${BUCKET}/${filePath(ref)}`, { headers: H(e.key) });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
async function fileExists(ref: string): Promise<boolean> {
  const e = env();
  const res = await fetch(`${e.url}/storage/v1/object/info/${BUCKET}/${filePath(ref)}`, { headers: H(e.key) });
  return res.ok;
}
/** Deletes the files of these refs (a missing file is not an error) and records it; returns the refs done. */
async function removeFiles(refs: string[]): Promise<string[]> {
  if (!refs.length) return [];
  const e = env();
  const res = await fetch(`${e.url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: H(e.key, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: refs.map(filePath) }) });
  if (!res.ok) {
    console.error('cv delete failed', refs.join(','), res.status, (await res.text()).slice(0, 200));
    return [];
  }
  await rpc('job_application_files_deleted', { p_refs: refs }).catch((x) => console.error('files_deleted mark failed', String(x)));
  return refs;
}

interface Recipient {
  scope: string;
  email: string;
}
/** To = the active careers recipients; none → the central recipients (never nobody). */
async function careersRecipients(ref: string): Promise<{ to: string[]; replyTo: string[] }> {
  try {
    const e = env();
    const res = await fetch(`${e.url}/rest/v1/booking_notification_recipients?active=eq.true&scope=in.(careers,central)&select=scope,email`, { headers: H(e.key) });
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = ((await res.json()) as Recipient[]).filter((r) => EMAIL.test(r.email ?? ''));
    const careers = [...new Set(rows.filter((r) => r.scope === 'careers').map((r) => r.email.toLowerCase()))];
    const central = [...new Set(rows.filter((r) => r.scope === 'central').map((r) => r.email.toLowerCase()))];
    if (!careers.length) console.error('recipients: no active careers recipient — sending to the central recipients', ref);
    return { to: careers.length ? careers : central, replyTo: careers.length ? careers : [content.jobs_email] };
  } catch (x) {
    console.error('recipients: read failed', ref, String(x));
    return { to: [], replyTo: [content.jobs_email] };
  }
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Resend id, or null with the reason (logged with the ref — never the form data). */
async function send(kind: string, ref: string, m: { from: string; to: string[]; replyTo?: string[]; mail: Mail; attachment?: { name: string; bytes: Uint8Array } }, test: boolean): Promise<{ id: string | null; error: string | null }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return fail(kind, ref, 'RESEND_API_KEY missing');
  if (!m.to.length) return fail(kind, ref, 'no recipient');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: m.from,
        to: test ? [TEST_SINK] : m.to,
        ...(m.replyTo?.length ? { reply_to: m.replyTo } : {}),
        subject: test ? `[TEST] ${m.mail.subject}` : m.mail.subject,
        html: m.mail.html,
        text: m.mail.text,
        ...(m.attachment ? { attachments: [{ filename: m.attachment.name, content: b64(m.attachment.bytes), content_type: 'application/pdf' }] } : {}),
      }),
    });
    if (!res.ok) return fail(kind, ref, `resend ${res.status} ${(await res.text()).slice(0, 160)}`);
    const id = String(((await res.json().catch(() => ({}))) as { id?: string }).id ?? 'sent');
    console.log(`email ${kind} sent`, ref, `id=${id}`, kind === 'jobs' ? `to=${(test ? [TEST_SINK] : m.to).join(';')}` : 'to=[applicant]', test ? 'TEST' : '');
    return { id, error: null };
  } catch (x) {
    return fail(kind, ref, String(x).slice(0, 160));
  }
}
function fail(kind: string, ref: string, error: string) {
  console.error(`email ${kind} not sent`, ref, error);
  return { id: null, error };
}

/** The row as the emails need it (personal fields present). */
interface Row {
  ref: string;
  created_at: string;
  is_test: boolean;
  locale: 'ar' | 'en';
  department: string;
  branch_pref: string;
  name: string;
  phone: string;
  email: string;
  nationality: string;
  city: string;
  experience: string | null;
  available_from: string | null;
  note: string | null;
  linkedin: string | null;
  consent_at: string;
  cv_size: number;
  send_attempts: number;
  last_error: string | null;
  confirmation_status: string;
}
const jobMail = (r: Row): JobMail => ({
  ref: r.ref, locale: r.locale, name: r.name, phone: r.phone, email: r.email, nationality: r.nationality, department: r.department, branch: r.branch_pref,
  city: r.city, experience: r.experience, available_from: r.available_from, note: r.note ?? '', linkedin: r.linkedin,
  cvFile: filePath(r.ref), cvBytes: r.cv_size, receivedAt: riyadhStamp(new Date(r.created_at)),
});

/** One delivery attempt: the jobs email with the CV (+ the applicant's confirmation while it is due); on acceptance the
 *  file is deleted and the personal fields nulled. Returns whether the jobs email was accepted. */
async function deliver(r: Row, bytes: Uint8Array | null, hook = ''): Promise<boolean> {
  const test = r.is_test;
  const { to, replyTo } = await careersRecipients(r.ref);
  const jobs = test && hook.includes('jobs')
    ? fail('jobs', r.ref, 'forced test failure')
    : bytes
    ? await send('jobs', r.ref, { from: FROM_JOBS, to, replyTo: [r.email], mail: jobApplicationNotification(content, jobMail(r)), attachment: { name: filePath(r.ref), bytes } }, test)
    : fail('jobs', r.ref, 'cv file missing from storage');
  let confirmation: string | null = null;
  if (r.confirmation_status === 'pending' || r.confirmation_status === 'failed') {
    const c = await send('applicant', r.ref, { from: FROM_APPLICANT, to: [r.email], replyTo, mail: jobApplicationConfirmation(content, { ref: r.ref, name: r.name }) }, test);
    confirmation = c.id ? 'sent' : 'failed';
  }
  await rpc('job_application_result', { p_ref: r.ref, p_sent: Boolean(jobs.id), p_resend_id: jobs.id, p_error: jobs.error, p_confirmation: confirmation }).catch((x) =>
    console.error('job_application_result failed', r.ref, String(x)),
  );
  if (jobs.id && !(test && hook.includes('delete'))) await removeFiles([r.ref]);
  else if (!jobs.id) console.error('job application not delivered — the sweep retries', r.ref, `attempt=${r.send_attempts + 1}`);
  return Boolean(jobs.id);
}

/** The sweep: purge (7 days), retries, leftover files, admin alerts. Never throws. */
async function sweep(): Promise<Record<string, number>> {
  const out = { purged: 0, retried: 0, delivered: 0, files: 0, alerts: 0 };
  try {
    const purged = await rpc<{ ref: string; unsent: boolean }[]>('job_applications_purge', {});
    out.purged = purged.length;
    for (const p of purged) if (p.unsent) console.error('job application purged UNSENT after 7 days', p.ref);
    const due = await rpc<Row[]>('job_applications_due', { p_limit: 10 });
    for (const r of due) {
      out.retried++;
      if (await deliver(r, await download(r.ref))) out.delivered++;
    }
    const e = env();
    const res = await fetch(`${e.url}/rest/v1/job_applications?file_deleted_at=is.null&purged_at=not.is.null&select=ref&limit=100`, { headers: H(e.key) });
    const left = res.ok ? ((await res.json()) as { ref: string }[]).map((x) => x.ref) : [];
    out.files = (await removeFiles(left)).length;
    const ar = await fetch(`${e.url}/rest/v1/job_applications?send_status=eq.purged_unsent&alert_sent_at=is.null&select=ref,created_at,is_test,department,branch_pref,send_attempts,last_error&limit=20`, { headers: H(e.key) });
    const alerts = ar.ok ? ((await ar.json()) as Row[]) : [];
    if (alerts.length) {
      const admins = await rpc<string[]>('job_application_admin_emails', {}).catch(() => [] as string[]);
      const fallback = admins.length ? admins : (await careersRecipients('alert')).to;
      for (const a of alerts) {
        const mail = jobApplicationAlert(content, { ref: a.ref, department: a.department, branch: a.branch_pref, submittedAt: riyadhStamp(new Date(a.created_at)), attempts: a.send_attempts, lastError: a.last_error ?? '' });
        const s = await send('purge-alert', a.ref, { from: FROM_JOBS, to: fallback, mail }, a.is_test);
        if (s.id) {
          await rpc('job_application_alerted', { p_refs: [a.ref] });
          out.alerts++;
        }
      }
    }
  } catch (x) {
    console.error('job sweep failed', String(x));
  }
  return out;
}

// ── QA (test token only) ────────────────────────────────────────────────────────────────────────────────────────
async function qa(req: Request, body: { action?: string; ref?: string; created_minutes_ago?: number; attempt_minutes_ago?: number }): Promise<Response> {
  const e = env();
  if (body.action === 'job-state') {
    const ref = String(body.ref ?? '');
    if (!/^AR-\d{8}-[A-Z0-9]{4}$/.test(ref)) return json(req, 400, { ok: false, error: 'ref' });
    const res = await fetch(`${e.url}/rest/v1/job_applications?ref=eq.${ref}&is_test=eq.true&select=*`, { headers: H(e.key) });
    const row = res.ok ? ((await res.json()) as Record<string, unknown>[])[0] : null;
    if (!row) return json(req, 404, { ok: false, error: 'not found' });
    const personal = ['name', 'phone', 'email', 'nationality', 'city', 'experience', 'available_from', 'note', 'linkedin', 'consent_at', 'cv_size'];
    return json(req, 200, {
      ok: true, ref, department: row.department, branch: row.branch_pref, send_status: row.send_status, confirmation_status: row.confirmation_status,
      send_attempts: row.send_attempts, purged: row.purged_at !== null, personal_null: personal.every((k) => row[k] === null),
      file_exists: await fileExists(ref), file_deleted: row.file_deleted_at !== null, alert_sent: row.alert_sent_at !== null,
      last_error: row.last_error,
    });
  }
  if (body.action === 'job-age') {
    const ref = String(body.ref ?? '');
    const mins = (v: unknown) => Math.max(0, Math.min(60 * 24 * 30, Number(v) || 0));
    if (!/^AR-\d{8}-[A-Z0-9]{4}$/.test(ref)) return json(req, 400, { ok: false, error: 'ref' });
    const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();
    const patch: Record<string, string> = { created_at: ago(mins(body.created_minutes_ago)) };
    if (body.attempt_minutes_ago !== undefined) patch.last_attempt_at = ago(mins(body.attempt_minutes_ago));
    const res = await fetch(`${e.url}/rest/v1/job_applications?ref=eq.${ref}&is_test=eq.true`, { method: 'PATCH', headers: H(e.key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify(patch) });
    return json(req, res.ok ? 200 : 500, { ok: res.ok });
  }
  if (body.action === 'job-sweep') return json(req, 200, { ok: true, ...(await sweep()) });
  if (body.action === 'job-cleanup') {
    const res = await fetch(`${e.url}/rest/v1/job_applications?is_test=eq.true&select=ref`, { headers: H(e.key) });
    const refs = res.ok ? ((await res.json()) as { ref: string }[]).map((x) => x.ref) : [];
    if (refs.length) await fetch(`${e.url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: H(e.key, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: refs.map(filePath) }) });
    await fetch(`${e.url}/rest/v1/job_applications?is_test=eq.true`, { method: 'DELETE', headers: H(e.key) });
    await fetch(`${e.url}/rest/v1/job_application_hits?key_hash=like.test*`, { method: 'DELETE', headers: H(e.key) });
    return json(req, 200, { ok: true, deleted: refs.length });
  }
  return json(req, 400, { ok: false, error: 'action' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const test = testMode(req);

  // JSON body: the sweep (pg_cron) or a QA action
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { action?: string; ref?: string };
    if (body.action === 'sweep') {
      // the token lives only in Vault: public.job_sweep_check compares it there
      const given = req.headers.get('x-armada-sweep') ?? '';
      const allowed = given.length >= 32 && (await rpc<boolean>('job_sweep_check', { p_token: given }).catch(() => false));
      if (!allowed) return json(req, 401, { ok: false });
      return json(req, 200, { ok: true, ...(await sweep()) });
    }
    if (test) return qa(req, body);
    return json(req, 400, { ok: false, error: 'multipart/form-data expected' });
  }

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid form data' });
  }
  const v = (k: string) => {
    const x = fd.get(k);
    return typeof x === 'string' ? x : '';
  };

  // 1. honeypot, then the per-IP limit (test mode: only on request, on a test-only key)
  if (v('website').trim() !== '') {
    console.warn('honeypot hit');
    return json(req, 200, { ok: true, ref: makeRef() });
  }
  const ipLimit = !test || (req.headers.get('x-armada-test-limits') ?? '').includes('ip');
  if (ipLimit) {
    try {
      const hits = await rpc<number>('job_application_ip_hit', { p_ip_hash: (test ? 'test:' : '') + (await sha(`jobs-ip:${clientIp(req)}`)), p_window_seconds: IP_WINDOW_SECONDS });
      if (hits > IP_LIMIT) return json(req, 429, { ok: false, error: 'too many requests' });
    } catch (x) {
      console.error('rate limit check failed', String(x)); // fails open
    }
  }

  // 2. validate (rules.ts) — the file by its own bytes
  const fileParts = fd.getAll('cv').filter((x): x is File => x instanceof File);
  const heads = await Promise.all(fileParts.map(async (f) => new Uint8Array(await f.slice(0, 8).arrayBuffer())));
  const files: JobFile[] = fileParts.map((f, i) => ({ name: f.name, size: f.size, head: heads[i] }));
  const r = validateJobApplication(
    { name: v('name'), phone: v('phone'), country: v('country'), email: v('email'), nationality: v('nationality'), department: v('department'), branch: v('branch'), city: v('city'), consent: v('consent'), experience: v('experience'), available_from: v('available_from'), note: v('note'), linkedin: v('linkedin'), files },
    { branches: KNOWN_BRANCHES, countries: COUNTRIES, today: riyadhToday(), phone: phoneE164 },
  );
  if (!r.ok) return json(req, 422, { ok: false, error: 'invalid application', fields: r.errors });
  const d = r.data;
  const bytes = new Uint8Array(await fileParts[0].arrayBuffer());

  // 3. at most QUOTA per email / phone in 24 h
  const prefix = test ? 'test:' : '';
  const emailHash = prefix + (await sha(`jobs-email:${d.email.toLowerCase()}`));
  const phoneHash = prefix + (await sha(`jobs-phone:${d.phone}`));
  try {
    if ((await rpc<number>('job_application_quota', { p_email_hash: emailHash, p_phone_hash: phoneHash })) >= QUOTA) return json(req, 429, { ok: false, error: 'quota' });
  } catch (x) {
    console.error('quota check failed', String(x));
  }

  // 4. the file, then the row (the quota re-checked under a lock)
  const ref = makeRef();
  const locale = v('locale') === 'en' ? 'en' : 'ar';
  if (!(await upload(ref, bytes))) return json(req, 500, { ok: false, error: 'could not store the application' });
  let stored: { status: string; id?: string };
  try {
    stored = await rpc('submit_job_application', {
      p: { ref, is_test: test, locale, department: d.department, branch: d.branch, name: d.name, phone: d.phone, email: d.email, nationality: d.nationality, city: d.city, experience: d.experience, available_from: d.available_from, note: d.note, linkedin: d.linkedin, cv_size: d.cv.size, email_hash: emailHash, phone_hash: phoneHash },
      p_max: QUOTA,
    });
  } catch (x) {
    console.error('submit_job_application failed', ref, String(x));
    await removeFiles([ref]);
    return json(req, 500, { ok: false, error: 'could not store the application' });
  }
  if (stored.status !== 'stored') {
    await removeFiles([ref]);
    return json(req, 429, { ok: false, error: 'quota' });
  }

  // 5 + 6. the emails; on acceptance the file and the personal fields go
  const now = new Date().toISOString();
  const row: Row = { ref, created_at: now, is_test: test, locale, department: d.department, branch_pref: d.branch, name: d.name, phone: d.phone, email: d.email, nationality: d.nationality, city: d.city, experience: d.experience, available_from: d.available_from, note: d.note, linkedin: d.linkedin, consent_at: now, cv_size: d.cv.size, send_attempts: 0, last_error: null, confirmation_status: 'pending' };
  const delivered = await deliver(row, bytes, test ? (req.headers.get('x-armada-test-fail') ?? '') : '');
  return json(req, 200, { ok: true, ref, delivered, is_test: test });
});
