// «حالة تحديث الموقع» — the dashboard's texts for the website's deploy status (6 Nov 2026, DECISIONS.md 2026-11-06 «A
// failed deploy is never silent»). Pure: no imports (scripts/admin-format-check.mjs tests it under Node). The data comes
// from public.site_deploy_status() (the deploy workflow reports each run; lib/siteDeploy.ts polls it).

export type DeployStatus = 'running' | 'succeeded' | 'failed';
export interface SiteDeploy {
  status: DeployStatus | null;
  started_at?: string | null;
  finished_at?: string | null;
  run_url?: string | null;
  commit?: string | null;
  failed_step?: string | null;
  alerted?: boolean;
  last_success_at?: string | null;
}
/** what the panel shows: the server's state, or «جارٍ» while a rebuild this tab asked for has not started yet */
export type DeployView = 'running' | 'succeeded' | 'failed' | 'unknown';

/** a run that starts within this margin before the change still reads it (client / server clocks) */
const SKEW_MS = 5000;
/** a request with no run started after it stops counting as «جارٍ» after this long */
export const PENDING_MS = 15 * 60 * 1000;
/** the update bar keeps a success on screen this long after it finished */
export const RECENT_MS = 30 * 60 * 1000;

export function deployTime(ts: string | number | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', '');
}

const t = (ts: string | null | undefined) => (ts ? new Date(ts).getTime() : NaN);

/** the newest run started after the request (a rebuild this tab asked for), if any */
export function startedAfter(d: SiteDeploy | null, since: number | null): boolean {
  return !!d?.status && since !== null && t(d.started_at) >= since - SKEW_MS;
}

export function deployView(d: SiteDeploy | null, requestedAt: number | null, now: number): DeployView {
  if (requestedAt !== null && now - requestedAt < PENDING_MS && !startedAfter(d, requestedAt)) return 'running';
  return d?.status ?? 'unknown';
}

export interface DeployLine { view: DeployView; text: string; detail: string | null; link: string | null }

export const DEPLOY_TEXT = {
  running: (since: string) => `جارٍ تحديث الموقع — بدأ ${since}`,
  requested: (at: string) => `جارٍ تحديث الموقع — طُلب ${at}`,
  succeeded: (at: string) => `آخر تحديث للموقع: نجح — ${at}`,
  failed: (at: string) => `آخر تحديث للموقع: فشل — ${at}`,
  failedDetail: (lastOk: string | null) => lastOk
    ? `ما حُفظ في اللوحة بعد آخر تحديث ناجح (${lastOk}) محفوظ، لكنه غير ظاهر على الموقع حتى ينجح تحديث جديد.`
    : 'ما حُفظ في اللوحة محفوظ، لكنه غير ظاهر على الموقع حتى ينجح تحديث جديد.',
  unknown: 'حالة آخر تحديث للموقع غير مسجّلة بعد.',
  runLink: 'سجل التشغيل',
};

export function deployLine(d: SiteDeploy | null, requestedAt: number | null, now: number): DeployLine {
  const view = deployView(d, requestedAt, now);
  if (view === 'running') {
    const own = d?.status === 'running' && (requestedAt === null || startedAfter(d, requestedAt));
    return { view, text: own ? DEPLOY_TEXT.running(deployTime(d?.started_at)) : DEPLOY_TEXT.requested(deployTime(requestedAt)), detail: null, link: own ? d?.run_url ?? null : null };
  }
  if (view === 'succeeded') return { view, text: DEPLOY_TEXT.succeeded(deployTime(d?.finished_at ?? d?.started_at)), detail: null, link: null };
  if (view === 'failed') {
    return { view, text: DEPLOY_TEXT.failed(deployTime(d?.finished_at ?? d?.started_at)), detail: DEPLOY_TEXT.failedDetail(d?.last_success_at ? deployTime(d.last_success_at) : null), link: d?.run_url ?? null };
  }
  return { view, text: DEPLOY_TEXT.unknown, detail: null, link: null };
}

/** the update bar shows the site's state while a deploy runs, after a failure, and for a while after a success */
export function barShowsDeploy(d: SiteDeploy | null, requestedAt: number | null, now: number): boolean {
  const view = deployView(d, requestedAt, now);
  if (view === 'running' || view === 'failed') return true;
  return view === 'succeeded' && now - t(d?.finished_at) < RECENT_MS;
}

// ── «الغرف»: the line under the page title after «متاحة للحجز على الموقع» changes ──
export type RebuildAsk = 'dispatched' | 'busy' | 'not_requested';
export const ROOMS_NOTE = {
  saved: 'تم حفظ التعديل، ونموذج الحجز يتبعه فورًا. سيظهر في صفحات الغرف بعد تحديث الموقع (دقائق).',
  notRequested: 'تم حفظ التعديل، ونموذج الحجز يتبعه فورًا، لكن تعذّر طلب تحديث الموقع الآن؛ سيظهر في صفحات الغرف عند التحديث التالي للموقع.',
  live: 'تم تحديث الموقع — التعديل ظاهر الآن في صفحات الغرف.',
  failed: (alerted: boolean) => `التعديل محفوظ في اللوحة، لكنه غير ظاهر على صفحات الغرف لأن تحديث الموقع فشل.${alerted ? ' أُرسل تنبيه بالبريد لمدير النظام.' : ''} سيظهر التعديل بعد أول تحديث ناجح للموقع.`,
};

/** the note for a change saved at `savedAt`, given how the rebuild request went and the site's state now */
export function roomsNote(ask: RebuildAsk, d: SiteDeploy | null, savedAt: number): { text: string; tone: 'ok' | 'info' | 'error' } {
  const after = startedAfter(d, savedAt);
  if (after && d?.status === 'succeeded') return { text: ROOMS_NOTE.live, tone: 'ok' };
  if (d?.status === 'failed' && (after || ask === 'not_requested')) return { text: ROOMS_NOTE.failed(!!d.alerted), tone: 'error' };
  if (ask === 'not_requested') return { text: ROOMS_NOTE.notRequested, tone: 'info' };
  return { text: ROOMS_NOTE.saved, tone: 'info' };
}
