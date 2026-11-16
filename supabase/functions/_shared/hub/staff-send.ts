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
import { alertPayload, isTeach, reportPayload, reportVars, staffFallback, staffGuard, staffSystemFor, staffUser, templateNeedsRead, templateReady } from './staff.ts';
import { pageOf, templateRows, templatesUrl, type TemplateItem } from '../../hub-admin/ycloud.ts';
import { learnCommand, learnLine, teachScope, yesNo, type Branch, type LineKey } from './learn.ts';

// deno-lint-ignore no-explicit-any
type Json = any;
/** a database call that throws on an error */
export type Call = <T = Json>(name: string, args: Record<string, unknown>) => Promise<T>;

const DAY_MS = 24 * 3600_000;

/**
 * A WABA's whole template list from YCloud (the list read of «تحديث حالة القوالب» — the single-template read failed on every
 * attempt in production, 15 Nov 2026), each row stored (status, category, body; read_at now). Returns the rows, or null when
 * YCloud could not be read (the reason logged by its kind, never a text).
 */
export async function readTemplates(call: Call, channelId: string, waba: string, fetchFn: typeof fetch = fetch, key = Deno.env.get('YCLOUD_API_KEY') ?? ''): Promise<ReturnType<typeof templateRows> | null> {
  if (!key || !waba) return null;
  const items: TemplateItem[] = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await fetchFn(templatesUrl(waba, page), { method: 'GET', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        console.warn('hub staff: template list refused', res.status);
        return null;
      }
      const p = pageOf<TemplateItem>(await res.json());
      items.push(...p.items);
      if (!p.more) break;
    }
  } catch (e) {
    console.warn('hub staff: template list unreachable', String((e as Error)?.name ?? 'error').slice(0, 40));
    return null;
  }
  const rows = templateRows(items, waba);
  for (const r of rows) {
    await call('hub_template_read_store', { p_channel: channelId, p_item: r }).catch((e) => console.warn('hub staff: template not stored', r.name, String(e).slice(0, 60)));
  }
  return rows;
}

/** the template's status and body: read again from YCloud right before a send when it is missing from the list, not
 *  «معتمد», its body differs from templates.md, or it was read more than a day ago (Ahmed, 15 Nov 2026); then judged */
export async function ensureTemplate(call: Call, it: Json, fetchFn: typeof fetch = fetch, key = Deno.env.get('YCLOUD_API_KEY') ?? ''): Promise<{ ok: boolean; reason: string | null }> {
  let t: Json = await call('hub_template_get', { p_channel: it.channel_id, p_name: it.template, p_language: it.language ?? 'ar' }).catch(() => ({}));
  const lang: 'ar' | 'en' = it.language === 'en' ? 'en' : 'ar';
  if (templateNeedsRead(t, it.template, Date.now(), DAY_MS, lang) && it.waba_id) {
    const rows = await readTemplates(call, it.channel_id, it.waba_id, fetchFn, key);
    const y = rows?.find((r) => r.name === it.template && r.language === (it.language ?? 'ar'));
    if (y) t = { status: y.status, body: y.body, read_at: new Date().toISOString() };
    else if (rows) t = {};
  }
  return templateReady(t, it.template, lang);
}

/** the daily refresh (Ahmed, 15 Nov 2026): every channel whose hub templates were not read in 24 hours (or are missing
 *  or not «معتمد») — public.hub_templates_due — read again from YCloud. Called by wa-automation's minute drain. */
export async function refreshDueTemplates(call: Call, fetchFn: typeof fetch = fetch, key = Deno.env.get('YCLOUD_API_KEY') ?? ''): Promise<number> {
  const due = await call<Json[]>('hub_templates_due', {}).catch(() => [] as Json[]);
  let n = 0;
  for (const ch of due ?? []) {
    const rows = await readTemplates(call, ch.channel_id, ch.waba_id, fetchFn, key);
    if (rows) n++;
  }
  return n;
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
  // H7b «التعلّم» (Ahmed, 15 Nov 2026): «تعلّم:», «امسح», «امسح N», «عرض:» and the yes / no after «أستبدل القديمة؟» —
  // fixed lines (copy.md §9.1); a teaching is queued for hub-agent (the model writes the card, then it replies)
  const cmd = text ? learnCommand(text) : null;
  const yn = cmd ? null : yesNo(text);
  if (cmd || yn) {
    const branch = String(ctx.unit?.branch ?? 'airport-road') as Branch;
    const lc = await call<Json>('hub_learn_command', {
      p: { phone: m.from, channel: m.to, message_id: ctx.message_id, command: cmd?.kind ?? yn, n: cmd?.kind === 'remove_n' ? cmd.n : null,
           scope: cmd?.kind === 'teach' ? teachScope(cmd.body, branch) : null, body: cmd && 'body' in cmd ? cmd.body : null, is_test: test },
    }).catch((e) => {
      console.error('hub learn: command failed', String(e).slice(0, 80));
      return { handled: true, line: 'failed' };
    });
    if (lc?.handled) {
      if (lc.queued !== undefined) return { staff: true, kind: ctx.kind, learn: lc.queued ? 'queued' : 'duplicate' };
      const body = learnLine((lc.line ?? 'failed') as LineKey, lc.vars ?? {});
      const sent = await sendSession({ payload: textPayload(m.to, m.from, body, ctx.message_id), windowExpiresAt: new Date((Date.parse(m.sentAt ?? '') || Date.now()) + DAY_MS).toISOString(), test, log: null });
      await call('hub_staff_chat_finish', { p_message: ctx.message_id, p: { body, status: sent.accepted ? sent.status : 'failed', provider_id: sent.messageId, error_code: sent.errorCode, models: [] } })
        .catch((e) => console.error('hub learn: answer not recorded', String(e).slice(0, 80)));
      return { staff: true, kind: ctx.kind, learn: lc.line ?? 'failed', sent: sent.status };
    }
  }
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
