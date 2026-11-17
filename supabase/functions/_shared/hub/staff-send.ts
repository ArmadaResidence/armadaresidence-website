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
import { buttonsPayload, sendSession, sendTemplate, textPayload } from '../../booking-request/whatsapp-send.ts';
import { hubDailyMail } from '../../booking-request/email.ts';
import { staffSystem } from './compose/index.ts';
import hubText from './text.generated.json' with { type: 'json' };
import type { ModelFn } from './model.ts';
import { costOf } from './model.ts';
import { alertPayload, branchShort, HUB_UPLOAD_REMINDER, isTeach, reminderFallback, reportPayload, reportVars, staffFallback, staffGuard, staffSystemFor, staffUser, templateNeedsRead, templateReady, uploadReminderPayload } from './staff.ts';
import { pageOf, templateRows, templatesUrl, type TemplateItem } from '../../hub-admin/ycloud.ts';
import { confirmButtons, intentAction, intentButtons, intentSystem, intentUser, learnLine, parseIntent, teachRoute, teachScope, yesNo, type Branch, type Followup, type LastTeaching, type LearnButton, type LineKey, type Scope, type Teacher, type TeachTurn } from './learn.ts';
/** prompts.md §9.3 as written */
const reminderSystem = (): string => (hubText as Json).prompts.reminder_system;

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
 *  guest's path. Teaching (H9 fix 1, 16 Nov 2026): a quick reply by its id, «امسح» / «امسح N», a follow-up waiting, the
 *  yes / no after «أستبدل القديمة؟»; a teacher's other message read for its meaning first (prompts.md §9.2) — never a
 *  request to resend in a format. Returns what happened (codes only). */
export async function staffChat(call: Call, content: Json, model: ModelFn,
  m: { from: string; to: string; text: string; id: string; sentAt: string | null; kind: string; buttonId?: string | null; audioSeconds?: number | null; voiceFailed?: boolean }, test: boolean): Promise<Record<string, unknown>> {
  const ctx = await call<Json>('hub_staff_chat_begin', { p: { phone: m.from, channel: m.to, text: m.text || null, provider_id: m.id, is_test: test, kind: m.kind,
    ...(m.audioSeconds ? { audio_seconds: m.audioSeconds } : {}) } });
  if (!ctx?.staff) return { staff: false, test_as_guest: !!ctx?.test_as_guest };
  if (!ctx.ok) return { staff: true, reason: ctx.reason ?? 'not_ok' };
  if (!ctx.gate) return { staff: true, reason: 'assistant_off' };
  const text = String(m.text ?? '').trim();
  const branch = String(ctx.unit?.branch ?? 'airport-road') as Branch;
  const models = ctx.models ?? {};
  const used: Json[] = [];
  const windowAt = new Date((Date.parse(m.sentAt ?? '') || Date.now()) + DAY_MS).toISOString();
  /** a reply from the number the colleague wrote to (with quick replies when given), recorded in their chat */
  const reply = async (body: string, buttons?: { id: string; title: string }[]): Promise<string> => {
    let sent: { accepted: boolean; status: string; messageId: string | null; errorCode: string | null };
    try {
      const payload = buttons?.length && body.length <= 1000 ? buttonsPayload(m.to, m.from, body, buttons, ctx.message_id) : textPayload(m.to, m.from, body, ctx.message_id);
      sent = await sendSession({ payload, windowExpiresAt: windowAt, test, log: null });
    } catch {
      sent = { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
    }
    await call('hub_staff_chat_finish', { p_message: ctx.message_id, p: { body, status: sent.accepted ? sent.status : 'failed', provider_id: sent.messageId, error_code: sent.errorCode, models: used } })
      .catch((e) => console.error('hub learn: answer not recorded', String(e).slice(0, 80)));
    return sent.status;
  };
  /** a learning command (copy.md §9.1's fixed lines) — the database decides; returns whether it was handled */
  const command = async (p: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const lc = await call<Json>('hub_learn_command', { p: { phone: m.from, channel: m.to, message_id: ctx.message_id, is_test: test, ...p } }).catch((e) => {
      console.error('hub learn: command failed', String(e).slice(0, 80));
      return { handled: true, line: 'failed' };
    });
    if (!lc?.handled) return null;
    if (lc.queued !== undefined) {
      // queued for hub-agent (it replies); the model call of the intent into the budget
      if (used.length) await call('hub_staff_chat_finish', { p_message: ctx.message_id, p: { body: '', models: used } }).catch(() => null);
      return { staff: true, kind: ctx.kind, learn: lc.queued ? 'queued' : 'duplicate' };
    }
    const line = (lc.line ?? 'failed') as LineKey;
    const body = learnLine(line, lc.vars ?? {});
    const buttons = line === 'intent_ask' && lc.followup_id ? intentButtons(String(lc.followup_id))
      : (line === 'saved_both' || line === 'saved' || line === 'revised') && lc.card_id ? confirmButtons(String(lc.card_id), (lc.scope ?? 'both') as Scope, false) : undefined;
    const sent = await reply(body, buttons);
    return { staff: true, kind: ctx.kind, learn: line, sent };
  };

  // H9 fix 3: a voice note that could not be heard — the colleague line «اكتبها لي», nothing else
  if (m.voiceFailed) return { staff: true, kind: ctx.kind, voice: 'failed', sent: await reply(learnLine('voice_failed')) };
  // H9 fix 1: teaching v2 — the context of this number (who may teach, what waits, the last teaching)
  const tc = text || m.buttonId ? await call<Json>('hub_teach_context', { p_phone: m.from }).catch(() => null) : null;
  const turn: TeachTurn = {
    text, buttonId: m.buttonId ?? null, teacher: (tc?.teacher ?? null) as Teacher | null, channelBranch: branch,
    followup: (tc?.followup ?? null) as Followup | null, last: (tc?.last ?? null) as LastTeaching | null, lastSent: tc?.last_sent ?? null,
  };
  const route = teachRoute(turn);
  if (route.kind === 'button') {
    const map: Record<LearnButton, string> = { ok: 'btn_ok', both: 'btn_both', edit: 'btn_edit', del: 'btn_del', save: 'intent_yes', no: 'intent_no' };
    const r = await command({ command: map[route.action], id: route.id });
    if (r) return r;
  } else if (route.kind === 'command') {
    const cmd = route.command;
    const r = await command({ command: cmd.kind, n: cmd.kind === 'remove_n' ? cmd.n : null, body: 'body' in cmd ? cmd.body : null });
    if (r) return r;
  } else if (route.kind === 'not_allowed') {
    const r = await command({ command: 'teach', scope: teachScope(text, branch), body: text });
    if (r) return r;
  } else if (route.kind === 'teach') {
    const r = await command({ command: 'teach', scope: route.scope, body: route.body, revises: route.revises, followup: route.followup ?? null });
    if (r) return r;
  }
  // the yes / no after «أستبدل القديمة؟» (only while that question waits — the database knows)
  const yn = route.kind === 'classify' || route.kind === 'chat' ? yesNo(text) : null;
  if (yn) {
    const r = await command({ command: yn });
    if (r) return r;
  }
  if (route.kind === 'classify') {
    const owner = !!turn.teacher?.owner;
    // H9 fix 3 (Ahmed, 17 Nov 2026): the staff path on hub_models.staff (claude-opus-5-5)
    const modelId = String(models.staff ?? models.understand ?? 'claude-opus-5-5');
    const r = await model({ layer: 'staff_chat', model: modelId, system: intentSystem(),
      user: intentUser({ branch, teacher: owner ? 'owner' : 'manager', message: text, last_teaching: turn.last?.text_ar ?? null,
        history: (ctx.history ?? []) as { author: 'colleague' | 'us'; body: string }[], starts_with_teach_word: isTeach(text) }) });
    used.push({ model: modelId, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: costOf(ctx.prices ?? {}, modelId, r.input_tokens, r.output_tokens) });
    const act = intentAction(turn, r.ok ? parseIntent(r.text) : null);
    console.log('hub learn: intent', act.kind);
    if (act.kind === 'teach') {
      const x = await command({ command: 'teach', scope: act.scope, body: act.body, revises: act.revises });
      if (x) return x;
    } else if (act.kind === 'ask') {
      const x = await command({ command: 'ask_intent', scope: act.scope, body: act.body });
      if (x) return x;
    } else if (act.kind === 'offer') {
      return { staff: true, kind: ctx.kind, learn: 'offer', sent: await reply(learnLine('offer', {})) };
    }
  }

  // the colleague chat (H9 fix 3: hub_models.staff — claude-opus-5-5)
  const modelId = String(models.staff ?? models.compose ?? 'claude-opus-5-5');
  let out = '';
  if (!text) out = staffFallback(text);
  else {
    const system = staffSystemFor(staffSystem(), branchName(content, branch, 'ar'));
    const user = staffUser({ branch, kind: ctx.kind === 'report' ? 'report' : 'staff', first_name: String(ctx.name ?? ''), now: String(ctx.now ?? ''), facts: ctx.facts ?? {},
      history: (ctx.history ?? []) as { author: 'colleague' | 'us'; body: string }[], message: text });
    let note = '';
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      const r = await model({ layer: 'staff_chat', model: modelId, system, user: note ? `${user}\n\nYOUR PREVIOUS REPLY WAS REFUSED: ${note}. Write it again without that.` : user });
      used.push({ model: modelId, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: costOf(ctx.prices ?? {}, modelId, r.input_tokens, r.output_tokens) });
      if (!r.ok) break;
      const g = staffGuard(r.text, ctx.facts ?? {}, text, String(ctx.now ?? ''));
      if (g.ok) out = r.text.trim();
      else note = `it held ${g.reasons.join(', ')} — no phone number, no email, no link or number outside FACTS`;
    }
    if (!out) out = staffFallback(text);
  }
  const sent = await reply(out);
  return { staff: true, kind: ctx.kind, sent, teach: isTeach(text) };
}

/**
 * H9 fix 1 (16 Nov 2026, Ahmed): the reminders that today's «قائمة المغادرين» is missing (07:00, 08:00, 08:30) and the
 * thank-you after the upload. Inside the staff member's 24-hour window with the branch number: a line written by the
 * model in the colleague tone (prompts.md §9.3, guarded; the template's own wording when the model cannot), a different
 * line each day. Outside it: the template hub_upload_reminder — only once YCloud shows it approved with the body of
 * templates.md §7; otherwise nothing is sent and the reason is recorded (the dashboard shows the missing list and, at
 * 08:30, «التنبيهات»). The thank-you only inside the window. Test rows: built and recorded `test`, never sent.
 */
export async function drainReminders(call: Call, content: Json, model: ModelFn, opts: { test?: boolean; collect?: (kind: string, payload: Json) => void } = {}): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0, skipped = 0, failed = 0;
  for (let round = 0; round < 3; round++) {
    const items = await call<Json[]>('hub_upload_reminders_claim', { p_limit: 20, p_test: !!opts.test }).catch((e) => {
      console.error('hub reminders: claim failed', String(e).slice(0, 80));
      return [] as Json[];
    });
    if (!items?.length) break;
    for (const it of items) {
      let mode: 'session' | 'template' | 'none' = 'none', status = 'skipped', pid: string | null = null, code: string | null = null, body: string | null = null;
      const used: Json[] = [];
      try {
        const bname = branchName(content, it.branch, 'ar');
        if (!it.sending_enabled && !it.is_test) code = 'sending_off';
        else if (it.window_expires_at) {
          mode = 'session';
          const modelId = String(it.models?.staff ?? it.models?.compose ?? 'claude-opus-5-5');
          const kind = it.round === 'thanks' ? 'thanks' : 'reminder';
          const user = [`KIND: ${kind}`, `ROUND: ${String(it.round).replace(/^r/, '') || '1'}`, `BRANCH: ${branchShort(bname)}`, `FIRST_NAME: ${it.first_name ?? ''}`,
            `ROLE: ${it.role === 'manager' ? 'manager' : 'staff'}`, `LINK: ${it.link}`,
            `LAST_MESSAGES: ${((it.history ?? []) as Json[]).map((h) => `${h.author}: ${String(h.body ?? '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n') || '(none)'}`,
            `EARLIER_LINES: ${((it.earlier ?? []) as string[]).map((x) => String(x).replace(/\s+/g, ' ').slice(0, 300)).join(' | ') || '(none)'}`].join('\n');
          const facts = kind === 'reminder' ? { link: it.link } : {};
          for (let attempt = 0; attempt < 2 && !body; attempt++) {
            const r = await model({ layer: 'staff_chat', model: modelId, system: reminderSystem(), user });
            used.push({ model: modelId, input_tokens: r.input_tokens, output_tokens: r.output_tokens });
            if (!r.ok) break;
            const g = staffGuard(r.text, facts, '', '9:30');
            if (g.ok && (kind === 'thanks' || r.text.includes(it.link))) body = r.text.trim();
          }
          if (!body && kind === 'reminder') body = reminderFallback(String(it.first_name ?? ''), bname, it.branch);
          if (!body) code = 'model';
          else {
            const payload = textPayload(it.from, it.to, body, it.id);
            if (it.is_test && opts.collect) opts.collect('reminder_session', payload);
            const r = await sendSession({ payload, windowExpiresAt: it.window_expires_at, test: !!it.is_test, log: null });
            status = r.accepted ? r.status : 'failed';
            pid = r.messageId;
            code = r.errorCode;
          }
        } else if (it.round !== 'thanks') {
          const ready = it.is_test ? { ok: true, reason: null } : await ensureTemplate(call, { channel_id: it.channel_id, waba_id: it.waba_id, template: HUB_UPLOAD_REMINDER, language: 'ar' });
          if (!ready.ok) code = ready.reason;
          else {
            mode = 'template';
            const payload = uploadReminderPayload(it.from, it.to, String(it.first_name ?? ''), bname, it.branch, it.id);
            if (it.is_test && opts.collect) opts.collect('reminder_template', payload);
            const r = await sendTemplate(payload, !!it.is_test);
            status = r.accepted ? r.status : 'failed';
            pid = r.messageId;
            code = r.errorCode;
          }
        } else code = 'no_window';
      } catch (e) {
        console.error('hub reminders: payload refused', String((e as Error)?.message ?? e).slice(0, 80));
        status = 'failed';
        code = 'payload';
      }
      await call('hub_upload_reminder_finish', { p_id: it.id, p: { mode, status, provider_id: pid, error_code: code, body: mode === 'session' ? body : null, models: used } })
        .catch((e) => console.error('hub reminders: outcome not recorded', String(e).slice(0, 80)));
      if (status === 'failed') failed++;
      else if (status === 'skipped') skipped++;
      else sent++;
      console.log('hub reminders:', it.round, mode, status, code ?? '');
    }
  }
  return { sent, skipped, failed };
}
