// «عروض إياب على واتساب» (Ahmed, 9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation»): an eyab_offer campaign to
// the members of «إياب» whose consent is granted and who did not stop WhatsApp offers.
//   - the state: the members it can reach (Arabic / English), those who stopped the offers, the cost per message (Meta's
//     Saudi rates, Settings → wa_message_cost), the YCloud webhook (a system admin registers it once — without it no
//     campaign may start, since an opt-out could not arrive);
//   - «رقمك للتجربة»: the user's own WhatsApp number (the only number a test goes to);
//   - the campaign: the sending number (branch), the languages, per language the approved template's three variables
//     ({{1}} title, {{2}} details, {{3}} valid until) and the button's offer (#offer-<slug> on /offers/); the preview is
//     the approved template filled exactly as the member will read it;
//   - «إرسال تجربة لنفسي» (saves, then one real message per language to the user's number) before «إرسال للأعضاء…»,
//     whose confirmation shows the count, the cost per message and the total — the user approves each real send;
//   - the history: who started each campaign, when, how many, sent / delivered / read / failed, the estimate and what
//     Meta charged (from the webhook); a running campaign shows its progress and can be stopped. «السجل» records the
//     start and the finish of each campaign.
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, countWord, riyadhDateTime, riyadhToday, type CountNoun } from '../lib/format';
import {
  AUDIENCE_LABELS, fieldError, langsOf, money, overview, preview, recipientsOf, registerWebhook, saveCampaign, sendTest, setTestPhone, START_ERRORS, startCampaign, STATE_LABELS,
  stopCampaign, type Audience, type Campaign, type Overview, type Vars,
} from '../lib/eyab';
import { Confirm, DirtyScope, ErrorBox, Field, Loading, Spinner, useToast } from '../components/ui';
import DateField from '../components/DateField';
import type { Locale } from '../../../supabase/functions/wa-automation/templates';

const MEMBER: CountNoun = { zero: 'لا أعضاء', one: 'عضو واحد', two: 'عضوان', few: 'أعضاء', many: 'عضوًا', gen: 'عضو' };
const MESSAGE: CountNoun = { zero: 'لا رسائل', one: 'رسالة واحدة', two: 'رسالتان', few: 'رسائل', many: 'رسالة', gen: 'رسالة' };
const EMPTY: Vars = { title: '', details: '', until: '', offer: '' };
const LANG_LABEL: Record<Locale, string> = { ar: 'النسخة العربية', en: 'النسخة الإنجليزية' };

function Bubble({ L, v, campaignId }: { L: Locale; v: Vars; campaignId: string | null }) {
  const p = preview(L, v, campaignId);
  return (
    <figure className="rounded-xl border border-line bg-card p-3 text-sm shadow-sm max-w-sm" dir={L === 'ar' ? 'rtl' : 'ltr'} lang={L} data-preview={L}>
      <p className="whitespace-pre-line leading-relaxed">{p.body}</p>
      {p.footer && <p className="mt-2 text-xs text-ink-muted">{p.footer}</p>}
      <div className="mt-2 grid gap-1 border-t border-line pt-2">
        {p.buttons.map((b) => (
          <span key={b.text} className="block text-center font-semibold text-accent-text" title={b.url ?? undefined}>{b.text}</span>
        ))}
      </div>
      <figcaption className="mt-2 text-[11px] text-ink-muted break-all" dir="ltr">{p.buttons[0]?.url}</figcaption>
    </figure>
  );
}

export default function EyabWhatsApp() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'eyab_wa');
  const [ov, setOv] = useState<Overview | null>(null);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  // the campaign being edited
  const [id, setId] = useState<string | null>(null);
  const [branch, setBranch] = useState('airport-road');
  const [audience, setAudience] = useState<Audience>('ar');
  const [vars, setVars] = useState<Record<Locale, Vars>>({ ar: { ...EMPTY }, en: { ...EMPTY } });
  const [saved, setSaved] = useState('');
  const [tested, setTested] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [stopId, setStopId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, b] = await Promise.all([overview(), api.branches()]);
      setOv(o);
      setBranches(b);
      setPhone((p) => p || o.test_phone || '');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // a campaign is sending: its progress every 3 s
  const sending = ov?.campaigns.some((c) => c.state === 'sending');
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [sending, load]);

  const current = JSON.stringify({ branch, audience, vars: Object.fromEntries(langsOf(audience).map((L) => [L, vars[L]])) });
  const dirty = current !== saved;
  const recipients = ov ? recipientsOf(ov.audience, audience) : 0;
  const costPer = ov?.cost?.marketing ?? null;

  function edit(c: Campaign) {
    setId(c.id);
    setBranch(c.branch);
    setAudience(c.audience);
    const v = { ar: { ...EMPTY, ...(c.vars.ar ?? {}) }, en: { ...EMPTY, ...(c.vars.en ?? {}) } };
    setVars(v);
    setSaved(JSON.stringify({ branch: c.branch, audience: c.audience, vars: Object.fromEntries(langsOf(c.audience).map((L) => [L, v[L]])) }));
    setTested(c.tested_current && !!c.tested_at && Date.now() - Date.parse(c.tested_at) < 86400000);
    setFormError(null);
    window.scrollTo({ top: 0 });
  }
  function fresh() {
    setId(null);
    setBranch('airport-road');
    setAudience('ar');
    setVars({ ar: { ...EMPTY }, en: { ...EMPTY } });
    setSaved('');
    setTested(false);
    setFormError(null);
  }

  /** saves the draft; returns its id or null */
  async function save(): Promise<string | null> {
    setFormError(null);
    const r = await saveCampaign(id, { branch, audience, vars: Object.fromEntries(langsOf(audience).map((L) => [L, vars[L]])) });
    if (!r.ok || !r.id) {
      setFormError(fieldError(r.field));
      return null;
    }
    setId(r.id);
    setSaved(current);
    setTested(!!r.tested_current);
    return r.id;
  }
  async function onSave() {
    setBusy('save');
    try {
      if (await save()) toast('حُفظت المسودة.');
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function onTest() {
    setBusy('test');
    try {
      const cid = await save();
      if (!cid) return;
      const r = await sendTest(cid);
      if (!r.ok && r.error) {
        setFormError(START_ERRORS[r.error] ?? 'تعذّر إرسال التجربة.');
        return;
      }
      const failed = (r.results ?? []).filter((x) => x.status === 'failed');
      if (failed.length) setFormError(`تعذّر إرسال التجربة (${failed.map((x) => LANG_LABEL[x.language]).join('، ')}). راجع رقمك ثم أعد المحاولة.`);
      else {
        setTested(true);
        toast(`أُرسلت ${countWord((r.results ?? []).length, MESSAGE)} تجربة إلى رقمك. راجعها على واتساب قبل الإرسال للأعضاء.`);
      }
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function onStart() {
    if (!id) return;
    setBusy('start');
    try {
      const r = await startCampaign(id, recipients);
      if (!r.ok) {
        setFormError(START_ERRORS[r.reason ?? ''] ?? 'تعذّر بدء الإرسال.');
        setConfirm(false);
        await load();
        return;
      }
      setConfirm(false);
      toast(`بدأ الإرسال إلى ${countWord(r.recipients ?? 0, MEMBER)}.`);
      fresh();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(null);
    }
  }
  async function onPhone() {
    setBusy('phone');
    try {
      const p = phone.replace(/[\s-]/g, '');
      if (!/^\+[1-9][0-9]{7,14}$/.test(p)) {
        toast('اكتب الرقم بالصيغة الدولية، مثل +9665XXXXXXXX.', 'error');
        return;
      }
      await setTestPhone(p);
      setPhone(p);
      toast('حُفظ رقمك للتجربة.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function onWebhook() {
    setBusy('webhook');
    try {
      const r = await registerWebhook();
      toast(r.ok ? 'تفعّل استقبال ردود واتساب.' : 'تعذّر التفعيل.', r.ok ? undefined : 'error');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function onStop() {
    if (!stopId) return;
    setBusy('stop');
    try {
      await stopCampaign(stopId);
      toast('أُوقف الإرسال؛ لن تُرسل الرسائل المتبقية.');
      setStopId(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const offers = ov?.offers ?? [];
  const drafts = useMemo(() => (ov?.campaigns ?? []).filter((c) => c.state === 'draft'), [ov]);
  if (!ov && !error) return <Loading />;
  const ro = !editable;

  return (
    <div className="grid gap-5 max-w-5xl">
      <h1 className="text-2xl font-bold">عروض إياب على واتساب</h1>
      <p className="text-sm text-ink-muted -mt-3">رسالة القالب المعتمد «eyab_offer» إلى أعضاء إياب — عضوية أرمادا ريزيدنس الذين وافقوا على تلقي العروض ولم يوقفوها. تصل كل عضو بلغته، من رقم الفرع الذي تختاره.</p>
      {ro && <p className="text-sm text-ink-muted -mt-3">صلاحيتك هنا للعرض فقط.</p>}
      <ErrorBox error={error} />

      {ov && (
        <section className="card p-5 grid gap-3 sm:grid-cols-3 num-ar" aria-labelledby="e-state" data-eyab-state>
          <h2 id="e-state" className="sr-only">الحالة</h2>
          <div>
            <div className="text-sm text-ink-muted">يمكن الإرسال إليهم</div>
            <div className="text-xl font-bold" data-count="eligible">{countWord(ov.audience.ar + ov.audience.en, MEMBER)}</div>
            <div className="text-xs text-ink-muted">بالعربية {ov.audience.ar} · بالإنجليزية {ov.audience.en} · أوقفوا العروض على واتساب {ov.audience.opted_out}</div>
          </div>
          <div>
            <div className="text-sm text-ink-muted">التكلفة التقديرية للرسالة</div>
            <div className="text-xl font-bold" data-cost>{money(costPer, 4)}</div>
            <div className="text-xs text-ink-muted">رسالة تسويقية بأسعار Meta للسعودية (أكتوبر 2026). التكلفة الفعلية تظهر في السجل أدناه بعد التسليم.</div>
          </div>
          <div>
            <div className="text-sm text-ink-muted">استقبال ردود واتساب (إيقاف العروض)</div>
            {ov.webhook ? (
              <div className="font-bold text-ok" data-webhook="on">مفعّل منذ {riyadhDateTime(ov.webhook.registered_at)}</div>
            ) : (
              <div className="grid gap-1" data-webhook="off">
                <div className="font-bold text-error">غير مفعّل — لا يمكن بدء حملة قبل تفعيله</div>
                {me?.is_admin && (
                  <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={onWebhook} disabled={!!busy} data-action="webhook-register">{busy === 'webhook' && <Spinner />} تفعيل استقبال الردود</button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {editable && (
        <section className="card p-5" aria-labelledby="e-phone">
          <h2 id="e-phone" className="font-bold text-lg mb-1">رقمك للتجربة</h2>
          <p className="text-sm text-ink-muted mb-3">رقم واتساب الخاص بك؛ التجربة تصل إليه وحده. {ov ? `أُرسل اليوم ${countWord(ov.tests_today, MESSAGE)} من 20.` : ''}</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="رقم واتساب (بالصيغة الدولية)" id="e-test-phone">
              <input id="e-test-phone" className="field num" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="+9665XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <button type="button" className="btn btn-ghost" onClick={onPhone} disabled={!!busy} data-action="save-phone">{busy === 'phone' && <Spinner />} حفظ الرقم</button>
          </div>
        </section>
      )}

      {editable && (
        <DirtyScope className="card p-5 grid gap-4" aria-labelledby="e-form" version={saved} data-scope="eyab-campaign">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="e-form" className="font-bold text-lg">{id ? 'تعديل المسودة' : 'حملة جديدة'}</h2>
            {id && <button type="button" className="btn btn-ghost btn-sm" onClick={fresh} disabled={!!busy}>حملة جديدة</button>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="يُرسل من رقم الفرع" id="e-branch">
              <select id="e-branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
                {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
              </select>
            </Field>
            <fieldset>
              <legend className="text-sm font-semibold mb-1">الأعضاء</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {(['ar', 'en', 'both'] as Audience[]).map((a) => (
                  <label key={a} className="flex items-center gap-1.5">
                    <input type="radio" name="e-audience" value={a} checked={audience === a} onChange={() => setAudience(a)} className="accent-bronze-deep" data-audience={a} />
                    {AUDIENCE_LABELS[a]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {langsOf(audience).map((L) => (
            <div key={L} className="grid lg:grid-cols-[1fr_auto] gap-4 rounded border border-line p-3" data-lang-block={L}>
              <div className="grid gap-3">
                <h3 className="font-bold">{LANG_LABEL[L]}</h3>
                <Field label="عنوان العرض — {{1}}" id={`e-title-${L}`} hint="حتى 60 حرفًا">
                  <input id={`e-title-${L}`} className="field" dir={L === 'ar' ? 'rtl' : 'ltr'} maxLength={60} value={vars[L].title} onChange={(e) => setVars({ ...vars, [L]: { ...vars[L], title: e.target.value } })} />
                </Field>
                <Field label="تفاصيل العرض — {{2}}" id={`e-details-${L}`} hint="سطر واحد، حتى 200 حرف">
                  <input id={`e-details-${L}`} className="field" dir={L === 'ar' ? 'rtl' : 'ltr'} maxLength={200} value={vars[L].details} onChange={(e) => setVars({ ...vars, [L]: { ...vars[L], details: e.target.value } })} />
                </Field>
                <DateField mode="single" id={`e-until-${L}`} label="صالح حتى — {{3}}" value={vars[L].until} min={riyadhToday()} onChange={(d) => setVars({ ...vars, [L]: { ...vars[L], until: d } })} />
                <Field label="زر «تفاصيل العرض» يفتح" id={`e-offer-${L}`}>
                  <select id={`e-offer-${L}`} className="field" value={vars[L].offer} onChange={(e) => setVars({ ...vars, [L]: { ...vars[L], offer: e.target.value } })}>
                    <option value="">صفحة العروض</option>
                    {offers.map((o) => <option key={o.slug} value={o.slug}>{(L === 'en' ? o.title_en : o.title_ar) || o.title_ar || o.slug}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid content-start gap-1">
                <span className="text-xs text-ink-muted">كما يراها العضو</span>
                <Bubble L={L} v={vars[L]} campaignId={id} />
              </div>
            </div>
          ))}
          <ErrorBox error={formError} />
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className="btn btn-ghost" onClick={onSave} disabled={!!busy} data-action="save-campaign">{busy === 'save' && <Spinner />} حفظ المسودة</button>
            <button type="button" className="btn btn-ghost" onClick={onTest} disabled={!!busy || !ov?.test_phone} data-action="test-campaign">{busy === 'test' && <Spinner />} إرسال تجربة لنفسي</button>
            <button type="button" className="btn btn-primary" onClick={() => setConfirm(true)} disabled={!!busy || !id || dirty || !tested || !ov?.webhook || recipients === 0} data-action="start-campaign">إرسال للأعضاء…</button>
            <span className="text-xs text-ink-muted" role="status">
              {!ov?.test_phone ? 'احفظ رقمك للتجربة أولًا.' : dirty ? 'التعديلات غير محفوظة: التجربة تحفظها.' : !tested ? 'أرسل تجربة لنفسك أولًا.' : !ov?.webhook ? START_ERRORS.no_webhook : `جاهزة: ${countWord(recipients, MEMBER)}.`}
            </span>
          </div>
        </DirtyScope>
      )}

      <Confirm
        open={confirm}
        title="إرسال العرض للأعضاء"
        confirmLabel={`أوافق وأرسل إلى ${countWord(recipients, MEMBER)}`}
        busy={busy === 'start'}
        onConfirm={onStart}
        onClose={() => setConfirm(false)}
        body={
          <div className="grid gap-2 text-sm num-ar" data-confirm-cost>
            <p>يُرسل من رقم {BRANCH_NAMES[branch]} إلى {AUDIENCE_LABELS[audience]}: <strong>{countWord(recipients, MEMBER)}</strong>.</p>
            <p>التكلفة التقديرية للرسالة: <strong>{money(costPer, 4)}</strong></p>
            <p>الإجمالي التقديري: <strong>{money(costPer === null ? null : costPer * recipients)}</strong></p>
            <p className="text-ink-muted">بأسعار Meta للرسائل التسويقية في السعودية (أكتوبر 2026)؛ تُحتسب الرسالة المسلَّمة فقط، والفاتورة الفعلية من YCloud. لا يمكن التراجع عن الإرسال، لكن يمكن إيقاف ما لم يُرسل بعد.</p>
          </div>
        }
      />
      <Confirm open={!!stopId} title="إيقاف الإرسال" confirmLabel="إيقاف الإرسال" danger busy={busy === 'stop'} onConfirm={onStop} onClose={() => setStopId(null)}
        body={<p className="text-sm">الرسائل التي أُرسلت لا تُسترجع؛ المتبقية لن تُرسل.</p>} />

      {ov && (
        <section className="card p-5" aria-labelledby="e-history">
          <h2 id="e-history" className="font-bold text-lg mb-3">الحملات</h2>
          {ov.campaigns.length === 0 ? (
            <p className="text-sm text-ink-muted">لا حملات بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm num-ar" data-campaigns>
                <thead>
                  <tr><th>العنوان</th><th>الحالة</th><th>بدأها</th><th>الفرع</th><th>الأعضاء</th><th>أُرسلت</th><th>سُلِّمت</th><th>قُرئت</th><th>تعذّرت</th><th>التقدير</th><th>الفعلي</th><th></th></tr>
                </thead>
                <tbody>
                  {ov.campaigns.map((c) => {
                    const k = c.counts;
                    return (
                      <tr key={c.id} data-campaign={c.state}>
                        <td>{c.vars.ar?.title ?? c.vars.en?.title}</td>
                        <td>{STATE_LABELS[c.state]}{c.state === 'sending' && k ? ` (${k.queued} متبقية)` : ''}</td>
                        <td>{c.started_by ?? c.created_by ?? '—'}<div className="text-xs text-ink-muted">{riyadhDateTime(c.started_at ?? c.created_at)}</div></td>
                        <td>{BRANCH_NAMES[c.branch]}</td>
                        <td>{c.state === 'draft' ? '—' : c.recipients}</td>
                        <td>{k?.sent ?? 0}</td>
                        <td>{k?.delivered ?? 0}</td>
                        <td>{k?.read ?? 0}</td>
                        <td>{(k?.failed ?? 0) + (k?.skipped ?? 0)}</td>
                        <td>{c.est_cost === null ? '—' : money(c.est_cost)}</td>
                        <td>{k?.cost ? money(k.cost) : '—'}</td>
                        <td>
                          {editable && c.state === 'draft' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(c)}>تعديل</button>}
                          {editable && c.state === 'sending' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStopId(c.id)} data-action="stop-campaign">إيقاف الإرسال</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {drafts.length > 0 && <p className="text-xs text-ink-muted mt-2">المسودات لا تُرسل لأحد حتى تُجرّب وتُعتمد.</p>}
        </section>
      )}
    </div>
  );
}
