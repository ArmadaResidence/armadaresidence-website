// The site-deploy alert email (6 Nov 2026, DECISIONS.md 2026-11-06 «A failed deploy is never silent»): one email to the
// dashboard's active admins per failed run of the website's deploy workflow — the deploy's own failure, or the deploy
// watchdog stopping because the last deploy failed. Arabic (Ahmed reads it), Western digits, Riyadh time. Pure module:
// scripts/deploy-alert-check.mjs imports it under Node (erasable TypeScript only).

export type AlertKind = 'deploy' | 'watchdog';
export interface AlertRun {
  run_id: number;
  run_url: string;
  commit: string;
  commit_title: string | null;
  event: string;
  failed_step: string | null;
  started_at: string | null;
  finished_at: string | null;
}
export interface AlertMail { subject: string; html: string; text: string }

export const EVENT_LABELS: Record<string, string> = {
  push: 'تعديل جديد على كود الموقع (push)',
  workflow_dispatch: 'طلب من اللوحة أو من مراقب النشر',
  schedule: 'التحديث اليومي المجدول',
  repository_dispatch: 'طلب خارجي',
  other: 'غير ذلك',
};

/** «2026-11-06 01:57» in Riyadh time (Western digits, 24 h) */
export function riyadhTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function alertEmail(kind: AlertKind, run: AlertRun, lastSuccessAt: string | null, test = false): AlertMail {
  const short = run.commit.slice(0, 7);
  const subject = `${test ? '[تجربة] ' : ''}${kind === 'watchdog' ? 'تنبيه: مراقب النشر أوقف تحديث الموقع' : 'تنبيه: فشل تحديث الموقع'} — ${short}`;
  const lead = kind === 'watchdog'
    ? 'أوقف مراقب النشر إعادة المحاولة تلقائيًا لأن آخر تحديث للموقع فشل. الموقع ما زال يعرض آخر نسخة نجحت.'
    : 'فشل تحديث الموقع، والموقع ما زال يعرض آخر نسخة نجحت.';
  const meaning = 'كل ما حُفظ في اللوحة بعد آخر تحديث ناجح — مثل «متاحة للحجز على الموقع» — محفوظ، لكنه لن يظهر على صفحات الموقع حتى ينجح تحديث جديد. نموذج الحجز وحده يتبع «الغرف» فورًا.';
  const rows: [string, string][] = [
    ['التعديل (commit)', `${short}${run.commit_title ? ` — ${run.commit_title}` : ''}`],
    ['الخطوة التي فشلت', run.failed_step || 'غير معروفة — راجع سجل التشغيل'],
    ['سبب التشغيل', EVENT_LABELS[run.event] ?? EVENT_LABELS.other],
    ['وقت التشغيل', `${riyadhTime(run.started_at)} (توقيت الرياض)`],
    ['آخر تحديث ناجح للموقع', lastSuccessAt ? `${riyadhTime(lastSuccessAt)} (توقيت الرياض)` : 'غير مسجّل'],
  ];
  const action = 'افتح سجل التشغيل على GitHub';
  const foot = 'يُرسَل هذا التنبيه مرة واحدة لكل تشغيل فاشل، إلى مديري النظام في لوحة أرمادا ريزيدنس.';
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#F3EFE7;font-family:Tahoma,Arial,sans-serif;color:#142A3B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EFE7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden">
<tr><td style="background:#142A3B;color:#F3EFE7;padding:16px 24px;font-size:18px;font-weight:bold">أرمادا ريزيدنس — تحديث الموقع</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.8">
<p style="margin:0 0 12px;font-weight:bold;color:#8B1E1E">${esc(lead)}</p>
<p style="margin:0 0 16px">${esc(meaning)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:8px;border-bottom:1px solid #E6DFD3;color:#5B6670;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px;border-bottom:1px solid #E6DFD3">${k.startsWith('التعديل') ? `<span dir="ltr">${esc(v)}</span>` : esc(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:20px 0 0"><a href="${esc(run.run_url)}" style="display:inline-block;background:#976E47;color:#FFFFFF;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">${esc(action)}</a></p>
<p style="margin:20px 0 0;font-size:12px;color:#5B6670">${esc(foot)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [lead, '', meaning, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `${action}: ${run.run_url}`, '', foot].join('\n');
  return { subject, html, text };
}
