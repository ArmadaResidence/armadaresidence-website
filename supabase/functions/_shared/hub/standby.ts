/**
 * Guest Hub — «وضع الاستعداد» (standby, Ahmed 16 Nov 2026 — DECISIONS.md 2026-11-16 «Guest Hub: standby mode»).
 *
 * Per branch, while «وضع الاستعداد: انتظر رد الفريق قبل رد المساعد» is on («الفريق والتقارير» → «فريق الاستقبال»), the
 * assistant waits «مدة الانتظار (دقائق)» (1–30) for a staff member to answer first. The wait applies to the first guest
 * message of an episode and to a guest message after a staff reply — only while at least one staff slot of that branch is on
 * shift by its schedule. Once the assistant has replied in the current exchange, the guest's follow-ups are answered at once.
 * Never delayed: the opt-out words and the «إلغاء» flow (they never queue a turn), a tap on one of our own buttons, staff and
 * management numbers (the colleague chat — never a turn).
 *
 * During the wait: no reply, no typing indicator, the message is NOT marked read (YCloud's typing call is what marks it
 * read, and it runs only once the turn is claimed), no staff alert. A staff reply during the wait → the assistant stands down
 * («مع موظف»; the «عودة المساعد» minutes apply). The wait ends with no staff reply → ONE reply to every message pending.
 *
 * The rule lives in the database (internal.hub_standby_minutes, called by public.hub_turn_queue); this file is its pure
 * twin for scripts/hub-standby-check.mjs (a simulated clock) and the countdown label «المساعد يرد بعد m:ss» (the dashboard's
 * twin: admin/src/lib/inbox.ts → standbyText).
 */

export const STANDBY_MIN = 1;
export const STANDBY_MAX = 30;
export const STANDBY_DEFAULT = 5;

export interface StandbyInput {
  /** the branch's switch and minutes */
  on: boolean;
  minutes: number;
  /** at least one active staff slot of the branch covers this moment (internal.hub_slot_covers) */
  onShift: boolean;
  /** the assistant already replied (a reply turn ran) since the last staff message of the episode */
  engaged: boolean;
  /** the guest tapped one of our buttons (an interactive / button reply) */
  tap: boolean;
  /** the turn would reply (a «مع موظف» message only tags — no reply to delay) */
  kind: 'reply' | 'tag';
}

/** the minutes to wait, or null = no wait (today's behaviour) */
export function standbyMinutes(x: StandbyInput): number | null {
  if (!x.on || x.kind !== 'reply' || x.tap || x.engaged || !x.onShift) return null;
  const m = Math.trunc(Number(x.minutes));
  return m >= STANDBY_MIN && m <= STANDBY_MAX ? m : null;
}

/** «m:ss» with Western digits; never below 0:00 */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** the countdown shown in «المحادثات» and «المحاكي» */
export const standbyLabel = (ms: number) => `المساعد يرد بعد ${countdownText(ms)}`;

/**
 * A simulated episode for the checks: a branch's settings and a timeline of events (minutes from the start). Returns what
 * the assistant does with each guest message — 'wait' joins the pending wait, 'now' is answered at once — and, for each
 * wait, how it ended: 'staff' (a staff reply inside it) or 'assistant' (at its end, every pending message in one reply).
 */
export type SimEvent =
  | { at: number; kind: 'guest'; text: string; tap?: boolean }
  | { at: number; kind: 'staff' }
  | { at: number; kind: 'optout' };
export interface SimResult {
  waits: { from: number; until: number; messages: string[]; outcome: 'staff' | 'assistant'; ended_at: number }[];
  immediate: string[];
  /** messages that never reached a turn (an opt-out word: its own flow, at once) */
  routed: string[];
  /** read receipts (the typing call) — the minute each was sent */
  reads: number[];
}
export function simulateStandby(cfg: { on: boolean; minutes: number; shift: (at: number) => boolean; resumeMinutes?: number }, events: SimEvent[]): SimResult {
  const res: SimResult = { waits: [], immediate: [], routed: [], reads: [] };
  let engaged = false;
  let lastStaff: number | null = null;
  let open: SimResult['waits'][number] | null = null;
  const resume = cfg.resumeMinutes ?? 15;
  const close = (at: number) => {
    // the wait's end: one reply to everything pending (the typing call marks it read now, not before)
    if (open && open.outcome === 'assistant' && open.until <= at) {
      open.ended_at = open.until;
      res.reads.push(open.until);
      engaged = true;
      open = null;
    }
  };
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    close(e.at);
    if (e.kind === 'optout') {
      res.routed.push('optout');
      continue;
    }
    if (e.kind === 'staff') {
      if (open) {
        open.outcome = 'staff';
        open.ended_at = e.at;
        open = null;
      }
      lastStaff = e.at;
      engaged = false;
      continue;
    }
    // «مع موظف»: silent until the branch's «عودة المساعد» minutes of staff silence (a tag, never a reply)
    const silent = lastStaff !== null && e.at - lastStaff < resume;
    if (silent) continue;
    if (open) {
      if (e.tap) {
        // a tap on our own button is never delayed: the pending wait ends with it, answered at once
        open.outcome = 'assistant';
        open.until = e.at;
        open.messages.push(e.text);
        close(e.at);
        continue;
      }
      open.messages.push(e.text);
      continue;
    }
    const m = standbyMinutes({ on: cfg.on, minutes: cfg.minutes, onShift: cfg.shift(e.at), engaged, tap: !!e.tap, kind: 'reply' });
    if (m === null) {
      res.immediate.push(e.text);
      res.reads.push(e.at);
      engaged = true;
      continue;
    }
    open = { from: e.at, until: e.at + m, messages: [e.text], outcome: 'assistant', ended_at: e.at + m };
    res.waits.push(open);
  }
  close(Number.POSITIVE_INFINITY);
  return res;
}

/** a «kind: standby» item of tests/hub-bank/conversations-standby.jsonl, graded by code (no model) */
export interface StandbyItem {
  id: string;
  settings: { on: boolean; minutes: number };
  shift: boolean | { from: number; to: number };
  events: SimEvent[];
  expect: { waits: { from: number; outcome: 'staff' | 'assistant'; ended_at: number; messages: number }[]; immediate: number; routed?: number; reads: number[] };
}
export function gradeStandby(q: StandbyItem): { pass: boolean; reasons: string[]; result: SimResult } {
  const shift = typeof q.shift === 'boolean' ? () => q.shift as boolean : (at: number) => at >= (q.shift as { from: number }).from && at < (q.shift as { to: number }).to;
  const r = simulateStandby({ on: q.settings.on, minutes: q.settings.minutes, shift }, q.events);
  const reasons: string[] = [];
  if (r.waits.length !== q.expect.waits.length) reasons.push(`waits:${r.waits.length}≠${q.expect.waits.length}`);
  q.expect.waits.forEach((w, i) => {
    const g = r.waits[i];
    if (!g) return;
    if (g.from !== w.from) reasons.push(`wait${i}.from:${g.from}`);
    if (g.outcome !== w.outcome) reasons.push(`wait${i}.outcome:${g.outcome}`);
    if (g.ended_at !== w.ended_at) reasons.push(`wait${i}.ended_at:${g.ended_at}`);
    if (g.messages.length !== w.messages) reasons.push(`wait${i}.messages:${g.messages.length}`);
  });
  if (r.immediate.length !== q.expect.immediate) reasons.push(`immediate:${r.immediate.length}`);
  if ((q.expect.routed ?? 0) !== r.routed.length) reasons.push(`routed:${r.routed.length}`);
  if (JSON.stringify(r.reads) !== JSON.stringify(q.expect.reads)) reasons.push(`reads:${r.reads.join(',')}`);
  // never a read receipt while a wait runs
  for (const w of r.waits) if (r.reads.some((t) => t >= w.from && t < w.ended_at)) reasons.push(`read_during_wait:${w.from}`);
  return { pass: reasons.length === 0, reasons, result: r };
}
