// /backup-codes — an admin's one-time backup codes (Ahmed, 26 Oct 2026 — break-glass for the email code): 10 codes,
// shown once, with download / print / copy; regenerating stops the old unused codes. The database generates them only
// within 10 minutes of an email-code verification of this session, so this page first sends a fresh code when needed
// (step-up). An admin with no codes is brought here after signing in; «لاحقًا» lets them continue for this tab (never a
// lock-out), and they are reminded at the next sign-in.
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorBox, Spinner, useToast } from '../components/ui';
import { maskEmail } from '../lib/device';
import { riyadhDateTimeLong, west } from '../lib/format';
import { BACKUP_TEXT as B, CODE_TEXT as T } from '../lib/secondStep';

export const BACKUP_LATER_KEY = 'armada-backup-later';
type Stage = 'intro' | 'stepup' | 'codes';

export default function BackupCodes() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [params] = useSearchParams();
  const from = (loc.state as { from?: string } | null)?.from ?? '/bookings';
  const forced = (me?.backup_codes_left ?? 0) === 0 && params.get('new') !== '1';
  const [stage, setStage] = useState<Stage>('intro');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  if (me && !me.is_admin) {
    nav('/bookings', { replace: true });
    return null;
  }

  async function sendStepUp() {
    setError(null);
    setInfo(null);
    try {
      const r = await api.sendLoginCode();
      if (r.ok) {
        setInfo(T.sent(maskEmail(me?.email)));
        setWait(r.resend_after ?? 60);
      } else if (r.reason === 'too_soon') {
        setInfo(T.tooSoon);
        setWait(r.retry_after ?? 60);
      } else if (r.reason === 'rate_limit') setError(T.rateLimit(Math.max(1, Math.ceil((r.retry_after ?? 3600) / 60))));
      else setError(T.sendFailed);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.generateBackupCodes();
      // the count first (quietly: a full refresh shows the splash and would unmount this page), then the codes — so
      // «متابعة» never meets a gate that still believes there are none
      await refresh(true);
      setCodes(r.codes);
      setGeneratedAt(r.generated_at);
      setStage('codes');
    } catch (e) {
      const raw = (e as { raw?: string }).raw ?? '';
      if (raw.startsWith('fresh_code_required')) {
        setStage('stepup');
        await sendStepUp();
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyStepUp(e?: FormEvent) {
    e?.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.verifyLoginCode(code, false, '');
      setCode('');
      if (!r.ok) {
        setBusy(false);
        if (r.reason === 'wrong') return setError(T.wrong(r.attempts_left ?? 0));
        if (r.reason === 'locked') return setError(T.locked);
        if (r.reason === 'expired') return setError(T.expired);
        return setError(T.none);
      }
    } catch (err) {
      setBusy(false);
      return setError((err as Error).message);
    }
    setBusy(false);
    await generate();
  }

  const fileText = () =>
    [B.fileTitle, me?.email ?? '', riyadhDateTimeLong(generatedAt || new Date().toISOString()), '', ...(codes ?? []).map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`), '', B.fileNote, ''].join('\r\n');
  function download() {
    const url = URL.createObjectURL(new Blob(['﻿' + fileText()], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'armada-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText((codes ?? []).join('\n'));
      toast(B.copied);
    } catch {
      /* clipboard blocked: download / print remain */
    }
  }
  function later() {
    try {
      sessionStorage.setItem(BACKUP_LATER_KEY, '1');
    } catch {
      /* ignore */
    }
    nav(from, { replace: true });
  }

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="card p-8 w-full max-w-md reveal" data-stage={stage}>
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-3 text-center">{B.title}</h1>

        {stage === 'intro' && (
          <>
            {forced && <p className="rounded border border-bronze/50 bg-soft px-3 py-2 text-sm mb-3" role="status" data-forced>{B.forced}</p>}
            <p className="text-sm text-ink-muted mb-4">{B.intro}</p>
            {!forced && (me?.backup_codes_left ?? 0) > 0 && <p className="text-sm text-ink mb-4">{B.regenerateWarn}</p>}
            <ErrorBox error={error} />
            <button type="button" className="btn btn-primary w-full" onClick={generate} disabled={busy} data-action="generate-backup">
              {busy && <Spinner />} {(me?.backup_codes_left ?? 0) > 0 ? B.regenerate : B.generate}
            </button>
            {forced ? (
              <>
                <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={later} data-action="backup-later">{B.later}</button>
                <p className="text-xs text-ink-muted text-center mt-1">{B.laterNote}</p>
              </>
            ) : (
              <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={() => nav('/security')}>{B.back}</button>
            )}
          </>
        )}

        {stage === 'stepup' && (
          <form onSubmit={verifyStepUp} noValidate>
            <p className="text-sm text-ink-muted mb-3">{B.stepUp}</p>
            {info && <p className="text-sm text-ink-muted mb-3" role="status">{info}</p>}
            <label className="label" htmlFor="stepup-code">{T.label}</label>
            <input id="stepup-code" className="field num text-center text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(west(e.target.value).replace(/\D/g, '').slice(0, 6))} />
            <ErrorBox error={error} />
            <button type="submit" className="btn btn-primary w-full mt-3" disabled={busy || code.length !== 6} data-action="verify-stepup">
              {busy && <Spinner />} {T.verify}
            </button>
            <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={sendStepUp} disabled={wait > 0 || busy}>
              {wait > 0 ? T.resendIn(wait) : T.resend}
            </button>
            {forced && <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={later}>{B.later}</button>}
          </form>
        )}

        {stage === 'codes' && codes && (
          <>
            <p className="text-sm text-ink-muted mb-3">{B.intro}</p>
            <div id="backup-print" className="rounded border border-line p-4 mb-3">
              <p className="font-bold mb-2 print-only-title">{B.yourCodes}</p>
              <ol className="grid grid-cols-2 gap-x-4 gap-y-2 latin num" dir="ltr" data-backup-codes>
                {codes.map((c) => (
                  <li key={c} className="font-semibold tracking-wider text-center">{c}</li>
                ))}
              </ol>
              <p className="text-xs text-ink-muted mt-3">{B.fileNote}</p>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <button type="button" className="btn btn-ghost btn-sm" onClick={download} data-action="download-backup">{B.download}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()} data-action="print-backup">{B.print}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy} data-action="copy-backup">{B.copy}</button>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="size-5 accent-bronze-deep" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-backup-saved />
              <span>{B.saved}</span>
            </label>
            <button type="button" className="btn btn-primary w-full mt-4" disabled={!saved} onClick={async () => { await refresh(true); nav(params.get('new') === '1' ? '/security' : from, { replace: true }); }} data-action="backup-continue">
              {B.continue}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
