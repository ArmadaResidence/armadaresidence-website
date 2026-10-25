// Landing page of the invite and the password-reset links (phase 2a.1 fix of the 25 Oct 2026 incident).
//
// The emails carry a token_hash link: /set-password?token_hash=…&type=invite|recovery. Nothing is verified on load —
// a mail scanner that opens the link cannot consume it — the user presses «متابعة», and only that click calls
// verifyOtp, which works in any browser or device (no PKCE code verifier is involved). Expired, used and invalid links
// get their own Arabic message and a «اطلب رابطًا جديدًا» path (a reset email to the address typed). Older link
// formats keep working: a PKCE `code` is exchanged, an implicit `#access_token` is picked up by the client, and a
// signed-in user (already verified) sees the form at once.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ErrorBox, Spinner } from '../components/ui';

type Stage = 'loading' | 'ready' | 'verifying' | 'form' | 'error';
type Reason = 'expired' | 'invalid' | 'none';

const TYPES: EmailOtpType[] = ['invite', 'recovery', 'magiclink', 'email', 'signup', 'email_change'];

// GoTrue answers a consumed, an unknown and an expired token_hash with the same «Token has expired or is invalid»
// (otp_expired); only a message that says expired alone is reported as expired
function classify(message: string): Reason {
  const m = message.toLowerCase();
  if (/expired/.test(m) && !/invalid/.test(m)) return 'expired';
  return 'invalid';
}
const REASON_TEXT: Record<Reason, string> = {
  expired: 'انتهت صلاحية هذا الرابط.',
  invalid: 'هذا الرابط لم يعد صالحًا: استُخدم من قبل، أو انتهت صلاحيته، أو نُسخ ناقصًا.',
  none: 'هذه الصفحة تُفتح من رابط الدعوة أو رابط تعيين كلمة المرور الذي وصلك بالبريد.',
};

export default function SetPassword() {
  const { session, loading, refresh } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = (TYPES.includes(params.get('type') as EmailOtpType) ? params.get('type') : 'recovery') as EmailOtpType;
  const hasCode = params.has('code');
  const hashTokens = /access_token=|error_description=/.test(location.hash);
  const [stage, setStage] = useState<Stage>(tokenHash ? 'ready' : 'loading');
  const [reason, setReason] = useState<Reason>('none');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // «اطلب رابطًا جديدًا»
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  // the older formats: a PKCE code / hash tokens become a session through the client; with none and no token_hash,
  // wait for the client to settle (onAuthStateChange) instead of a fixed timer
  useEffect(() => {
    if (tokenHash) return;
    if (!loading && session) {
      setStage('form');
      return;
    }
    if (hasCode || hashTokens) {
      const m = new URLSearchParams(location.hash.slice(1)).get('error_description');
      if (m) {
        setReason(classify(m));
        setStage('error');
        return;
      }
      const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
        if (s && (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) setStage('form');
      });
      const t = window.setTimeout(() => setStage((st) => (st === 'loading' ? 'error' : st)), 8000);
      return () => {
        sub.subscription.unsubscribe();
        window.clearTimeout(t);
      };
    }
    if (!loading) {
      setReason('none');
      setStage('error');
    }
  }, [tokenHash, hasCode, hashTokens, loading, session]);

  async function proceed() {
    if (!tokenHash) return;
    setStage('verifying');
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      setReason(classify(error.message));
      setStage('error');
      return;
    }
    await refresh();
    setStage('form');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (p1.length < 10) return setError('كلمة المرور 10 أحرف على الأقل.');
    if (p1 !== p2) return setError('كلمتا المرور غير متطابقتين.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) return setError(/weak|pwned|at least/i.test(error.message) ? 'كلمة المرور ضعيفة أو شائعة، اختر كلمة أطول.' : error.message);
    await refresh();
    nav('/bookings', { replace: true });
  }

  async function requestNew() {
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) return setError('اكتب بريدك الإلكتروني.');
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(addr);
    setBusy(false);
    if (error) return setError(/rate limit|security purposes/i.test(error.message) ? 'طُلب رابط قبل قليل؛ انتظر دقيقة ثم أعد المحاولة.' : error.message);
    setSent('إن كان البريد مسجّلًا فستصلك رسالة برابط جديد خلال دقائق. افتح الرسالة الأحدث فقط.');
  }

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm reveal" data-stage={stage}>
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-6 text-center">تعيين كلمة المرور</h1>

        {stage === 'loading' && (
          <p className="text-sm text-ink-muted text-center" role="status"><Spinner /> جارٍ التحقق من الرابط…</p>
        )}

        {(stage === 'ready' || stage === 'verifying') && (
          <>
            <p className="text-sm text-ink-muted mb-5">{type === 'invite' ? 'وصلتك دعوة إلى لوحة التحكم. اضغط «متابعة» لتأكيد الرابط ثم اختر كلمة المرور.' : 'اضغط «متابعة» لتأكيد الرابط ثم اختر كلمة المرور الجديدة.'}</p>
            <button type="button" className="btn btn-primary w-full" onClick={proceed} disabled={stage === 'verifying'} data-action="proceed">
              {stage === 'verifying' && <Spinner />} متابعة
            </button>
          </>
        )}

        {stage === 'form' && (
          <>
            <label className="label" htmlFor="p1">كلمة المرور الجديدة</label>
            <input id="p1" className="field latin mb-4" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={p1} onChange={(e) => setP1(e.target.value)} />
            <label className="label" htmlFor="p2">تأكيد كلمة المرور</label>
            <input id="p2" className="field latin mb-2" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={p2} onChange={(e) => setP2(e.target.value)} />
            <p className="text-xs text-ink-muted mb-2">10 أحرف على الأقل.</p>
            <ErrorBox error={error} />
            <button type="submit" className="btn btn-primary w-full mt-3" disabled={busy || !session} data-action="save-password">
              {busy && <Spinner />} حفظ والمتابعة
            </button>
          </>
        )}

        {stage === 'error' && (
          <>
            <p className="text-sm text-error font-semibold mb-2" role="alert" data-reason={reason}>{REASON_TEXT[reason]}</p>
            <p className="text-sm text-ink-muted mb-4">اطلب رابطًا جديدًا بكتابة بريدك، أو اطلبه من مدير النظام. يعمل الرابط الأحدث فقط.</p>
            {sent ? (
              <p className="text-sm text-ok my-3" role="status">{sent}</p>
            ) : (
              <>
                <label className="label" htmlFor="email">البريد الإلكتروني</label>
                <input id="email" className="field latin mb-2" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
                <ErrorBox error={error} />
                <button type="button" className="btn btn-primary w-full mt-3" onClick={requestNew} disabled={busy} data-action="request-link">
                  {busy && <Spinner />} اطلب رابطًا جديدًا
                </button>
              </>
            )}
            <a className="btn btn-ghost w-full mt-2 btn-sm" href={`${import.meta.env.BASE_URL}login`}>إلى صفحة الدخول</a>
          </>
        )}
      </form>
    </main>
  );
}
