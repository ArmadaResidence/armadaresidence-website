/**
 * Guest Hub H6c (15 Nov 2026): the WhatsApp sends to the TEAM — the staff alerts hub_staff_alert (a new hand-off, the
 * escalation) and the daily report hub_daily_report — and the colleague chat of a staff or report number. Used by
 * wa-automation (the cron's drain, «إرسال تجربة لي», the webhook's staff path) and hub-agent (right after a hand-off).
 * Every send: the template's status and body read back from YCloud before its first use (and again after 24 hours) and
 * compared with templates.md (hub-templates.json) — a template that is not APPROVED or whose body differs is never sent;
 * the number's «الإرسال من المركز» must be on; YCloud's answer recorded (public.hub_staff_send_finish), its later statuses
 * by wa_status_update. Test rows build the payload and are recorded `test`, never sent. Never retried by itself.
 * No log line carries a name, a number or a text.
 */
import { branchName } from '../../booking-request/whatsapp.ts';
import { sendSession, sendTemplate, textPayload } from '../../booking-request/whatsapp-send.ts';
import { hubDailyMail } from '../../booking-request/email.ts';
import { staffSystem } from './compose/index.ts';
import type { ModelFn } from './model.ts';
import { costOf } from './model.ts';
import { alertPayload, isTeach, reportPayload, reportVars, staffFallback, staffGuard, staffSystemFor, staffUser, templateReady, templateUrl, ycloudTemplate } from './staff.ts';

// deno-lint-ignore no-explicit-any
type Json = any;
/** a database call that throws on an error */
export type Call = <T = Json>(name: string, args: Record<string, unknown>) => Promise<T>;

const DAY_MS = 24 * 3600_000;

/** the template's status and body: read from YCloud when unread or older than a day, stored, then judged */
export async function ensureTemplate(call: Call, it: Json): Promise<{ ok: boolean; reason: string | null }> {
  let t: Json = await call('hub_template_get', { p_channel: it.channel_id, p_name: it.template, p_language: it.language ?? 'ar' }).catch(() => ({}));
  const stale = !t?.status || !t?.body || !t?.read_at || Date.now() - Date.parse(t.read_at) > DAY_MS;
  const key = Deno.env.get('YCLOUD_API_KEY');
  if (stale && key && it.waba_id) {
    try {
      const res = await fetch(templateUrl(it.waba_id, it.template, it.language ?? 'ar'), { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const y = ycloudTemplate(await res.json());
        if (y.name && y.status) {
          await call('hub_template_read_store', { p_channel: it.channel_id, p_item: { name: y.name, language: y.language || 'ar', status: y.status, category: y.category, body: y.body } });
          t = { status: y.status, body: y.body };
        }
      } else console.warn('hub staff: template read refused', it.template, res.status);
    } catch {
      console.warn('hub staff: template read unreachable', it.template);
    }
  }
  return templateReady(t, it.template);
}

/** the queued alerts and reports, each sent once (test rows: payload built, recorded `test`) */
export async function drainStaff(call: Call, content: Json, opts: { test?: boolean; collect?: (kind: string, payload: Json) => void } = {}): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0, failed = 0, skipped = 0;
  const ready = new Map<string, { ok: boolean; reason: string | null }>();
  for (let round = 0; round < 5; round++) {
    const items = await call<Json[]>('hub_staff_sends_claim', { p_limit: 20, p_test: !!opts.test }).catch((e) => {
      console.error('hub staff: claim failed', String(e).slice(0, 80));
      return [] as Json[];
    });
    if (!items?.length) break;
    for (const it of items) {
      let status = 'failed', pid: string | null = null, code: string | null = null;
      try {
        if (!it.sending_enabled && !it.is_test) {
          status = 'skipped';
          code = 'sending_off';
        } else {
          const k = `${it.channel_id}|${it.template}`;
          if (!ready.has(k)) ready.set(k, it.is_test ? { ok: true, reason: null } : await ensureTemplate(call, it));
          const r0 = ready.get(k)!;
          if (!r0.ok) {
            status = 'skipped';
            code = r0.reason;
          } else {
            const payload = it.handoff
              ? alertPayload(it.from, it.to, {
                token: it.handoff.token, branch_name: branchName(content, it.handoff.branch, 'ar'), guest_name: it.handoff.guest_name ?? null,
                guest_phone: it.handoff.guest_phone ?? null, ref: it.handoff.ref ?? null, summary: it.handoff.summary ?? null, reason: it.handoff.reason ?? null,
              }, it.id)
              : reportPayload(it.from, it.to, String(it.report?.day ?? ''), it.report?.data ?? {}, it.id);
            // QA (a preview branch): the payload of a TEST row handed back for the e2e's assertions, never sent
            if (it.is_test && opts.collect) opts.collect(it.kind, payload);
            const r = await sendTemplate(payload, !!it.is_test);
            status = r.accepted ? r.status : 'failed';
            pid = r.messageId;
            code = r.errorCode;
          }
        }
      } catch (e) {
        console.error('hub staff: payload refused', it.template, String((e as Error)?.message ?? e).slice(0, 80));
        status = 'failed';
        code = 'payload';
      }
      await call('hub_staff_send_finish', { p_send: it.id, p_status: status, p_provider_id: pid, p_error_code: code }).catch((e) =>
        console.error('hub staff: outcome not recorded', String(e).slice(0, 80)));
      if (status === 'failed') failed++;
      else if (status === 'skipped') skipped++;
      else sent++;
      console.log('hub staff:', it.kind, status, code ?? '');
    }
  }
  return { sent, failed, skipped };
}

/** the email archive of a stored daily report (once): the hub_summary recipients */
export async function emailReports(call: Call, content: Json, mail: (to: string[], m: { subject: string; html: string; text: string }) => Promise<boolean>): Promise<number> {
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const r = await call<Json>('hub_report_email_claim', {}).catch(() => null);
    if (!r?.report) break;
    const day = String(r.report.day);
    const ok = await mail((r.recipients ?? []) as string[], hubDailyMail(content, { day, vars: reportVars(day, r.report.data) }));
    console.log('hub staff: report email', ok ? 'sent' : 'not sent');
    if (ok) n++;
  }
  return n;
}

/** a message from a staff or report number: the colleague chat (prompts.md §9), from the number it wrote to; never a
 *  guest's path. Returns what happened (codes only). */
export async function staffChat(call: Call, content: Json, model: ModelFn, m: { from: string; to: string; text: string; id: string; sentAt: string | null; kind: string }, test: boolean): Promise<Record<string, unknown>> {
  const ctx = await call<Json>('hub_staff_chat_begin', { p: { phone: m.from, channel: m.to, text: m.text || null, provider_id: m.id, is_test: test } });
  if (!ctx?.staff) return { staff: false, test_as_guest: !!ctx?.test_as_guest };
  if (!ctx.ok) return { staff: true, reason: ctx.reason ?? 'not_ok' };
  if (!ctx.gate) return { staff: true, reason: 'assistant_off' };
  const text = String(m.text ?? '').trim();
  const models = ctx.models ?? {};
  const modelId = String(models.compose ?? 'claude-sonnet-5-5');
  const used: Json[] = [];
  let reply = '';
  if (!text) reply = staffFallback(text);
  else {
    const branch = String(ctx.unit?.branch ?? 'airport-road');
    const system = staffSystemFor(staffSystem(), branchName(content, branch, 'ar'));
    const user = staffUser({ branch, kind: ctx.kind === 'report' ? 'report' : 'staff', first_name: String(ctx.name ?? ''), now: String(ctx.now ?? ''), facts: ctx.facts ?? {},
      history: (ctx.history ?? []) as { author: 'colleague' | 'us'; body: string }[], message: text });
    let note = '';
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const r = await model({ layer: 'staff_chat', model: modelId, system, user: note ? `${user}\n\nYOUR PREVIOUS REPLY WAS REFUSED: ${note}. Write it again without that.` : user });
      used.push({ model: modelId, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: costOf(ctx.prices ?? {}, modelId, r.input_tokens, r.output_tokens) });
      if (!r.ok) break;
      const g = staffGuard(r.text, ctx.facts ?? {}, text, String(ctx.now ?? ''));
      if (g.ok) reply = r.text.trim();
      else note = `it held ${g.reasons.join(', ')} — no phone number, no email, no link or number outside FACTS`;
    }
    if (!reply) reply = staffFallback(text);
  }
  const sent = await sendSession({ payload: textPayload(m.to, m.from, reply, ctx.message_id), windowExpiresAt: new Date((Date.parse(m.sentAt ?? '') || Date.now()) + DAY_MS).toISOString(), test, log: null });
  await call('hub_staff_chat_finish', { p_message: ctx.message_id, p: { body: reply, status: sent.accepted ? sent.status : 'failed', provider_id: sent.messageId, error_code: sent.errorCode, models: used } })
    .catch((e) => console.error('hub staff chat: not recorded', String(e).slice(0, 80)));
  return { staff: true, kind: ctx.kind, sent: sent.status, teach: isTeach(text) };
}
