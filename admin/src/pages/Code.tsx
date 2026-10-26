// /code — the second sign-in step (phase 2a.2 C, Ahmed 26 Oct 2026): a 6-digit code sent to the email the user signs
// in with. On arrival a remembered device («تذكّر هذا الجهاز لمدة 30 يومًا») passes at once; otherwise the login-code
// function emails a code (60 s between codes of a session — the button counts down). The database checks the code
// (public.verify_login_code: 10 minutes, 5 attempts) and marks this session verified. Admins (users:edit) can use a
// one-time backup code when the email does not arrive. Replaces the TOTP page (/mfa redirects here).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorBox, Spinner, useToast } from '../components/ui';
import { clearDeviceToken, deviceLabel, getDeviceToken, maskEmail, setDeviceToken } from '../lib/device';
import { west } from '../lib/format';
import { CODE_TEXT as T } from '../lib/secondStep';

type Stage = 'device' | 'sending' | 'form' | 'backup';

export default function Code() {
  const { session, me, refresh, signOut } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const from = (loc.state as { from?: string } | null)?.from ?? '/bookings';
  const [stage, setStage] = useState<Stage>('device');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const uid = session?.user.id ?? '';

  // passed (here or in another tab): continue where the user was going
  useEffect(() => {
    if (me && !me.needs_second_factor) nav(from === '/code' ? '/bookings' : from, { replace: true });
  }, [me, from, nav]);

  // the resend countdown
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function send() {
    setStage('sending');
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
      } else if (r.reason === 'rate_limit') {
        setError(T.rateLimit(Math.max(1, Math.ceil((r.retry_after ?? 3600) / 60))));
        setWait(r.retry_after ?? 3600);
      } else if (r.reason === 'send_failed') {
        setError(T.sendFailed);
      } else {
        setError(T.sendFailed);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage((s) => (s === 'sending' ? 'form' : s));
    }
  }

  // on arrival: a remembered device first, else a code
  useEffect(() => {
    if (!uid || !me?.needs_second_factor || started.current) return;
    started.current = true;
    (async () => {
      const token = getDeviceToken(uid);
      if (token) {
        try {
          const r = await api.useRememberedDevice(token);
          if (r.ok) {
            await refresh();
            return;
          }
        } catch {
          /* fall through to the code */
        }
        clearDeviceToken(uid);
      }
      await send();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, me?.needs_second_factor]);

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.verifyLoginCode(code, remember, deviceLabel());
      if (r.ok) {
        if (r.device_token) setDeviceToken(uid, r.device_token);
        await refresh();
        return;
      }
      setCode('');
      if (r.reason === 'wrong') setError(T.wrong(r.attempts_left ?? 0));
      else if (r.reason === 'locked') setError(T.locked);
      else if (r.reason === 'expired') setError(T.expired);
      else setError(T.none);
      if (r.reason !== 'wrong') setWait(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyBackup(e?: FormEvent) {
    e?.preventDefault();
    if (!backup.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.useBackupCode(backup);
      if (r.ok) {
        toast(T.backupUsed(r.left ?? 0));
        await refresh();
        return;
      }
      if (r.reason === 'wrong') setError(T.backupWrong(r.attempts_left ?? 0));
      else if (r.reason === 'locked') setError(T.backupLocked);
      else setError(T.backupNone);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="card p-8 w-full max-w-sm reveal" data-stage={stage}>
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-3 text-center">{T.title}</h1>

        {(stage === 'device' || stage === 'sending') && (
          <p className="text-sm text-ink-muted text-center my-6" role="status">
            <Spinner /> {stage === 'device' ? T.checkingDevice : T.sending}
          </p>
        )}

        {stage === 'form' && (
          <form onSubmit={verify} noValidate>
            {info && <p className="text-sm text-ink-muted mb-4" role="status" data-code-info>{info}</p>}
            <label className="label" htmlFor="code">{T.label}</label>
            <input
              id="code"
              className="field num text-center text-lg tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(west(e.target.value).replace(/\D/g, '').slice(0, 6))}
              aria-describedby={error ? 'code-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
            <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
              <input type="checkbox" className="size-5 accent-bronze-deep" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-remember />
              <span>{T.remember}</span>
            </label>
            <p className="text-xs text-ink-muted mt-1 ms-7">{T.rememberHint}</p>
            <div id="code-error"><ErrorBox error={error} /></div>
            <button type="submit" className="btn btn-primary w-full mt-3" disabled={busy || code.length !== 6} data-action="verify-code">
              {busy && <Spinner />} {T.verify}
            </button>
            <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={send} disabled={wait > 0 || busy} data-action="resend-code">
              {wait > 0 ? T.resendIn(wait) : T.resend}
            </button>
            {me?.is_admin && (
              <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={() => { setError(null); setStage('backup'); }} data-action="use-backup">
                {T.backupLink}
              </button>
            )}
          </form>
        )}

        {stage === 'backup' && (
          <form onSubmit={verifyBackup} noValidate>
            <label className="label" htmlFor="backup-code">{T.backupLabel}</label>
            <input id="backup-code" className="field latin text-center tracking-wider" dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={14}
              value={backup} onChange={(e) => setBackup(e.target.value.toUpperCase())} />
            <p className="text-xs text-ink-muted mt-1">{T.backupHint}</p>
            <ErrorBox error={error} />
            <button type="submit" className="btn btn-primary w-full mt-3" disabled={busy || !backup.trim()} data-action="verify-backup">
              {busy && <Spinner />} {T.backupVerify}
            </button>
            <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={() => { setError(null); setStage('form'); }}>{T.backupBack}</button>
          </form>
        )}

        <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={signOut}>{T.signOut}</button>
      </div>
    </main>
  );
}
