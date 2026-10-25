import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ErrorBox, Spinner } from '../components/ui';

/** The Supabase Auth messages a user can meet here, in Arabic. */
export function arabicAuth(m: string): string {
  if (/invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/email not confirmed/i.test(m)) return 'الحساب لم يُفعَّل بعد: افتح رابط الدعوة من بريدك أولًا.';
  if (/rate limit|security purposes|too many/i.test(m)) return 'محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة.';
  if (/user not found|signups not allowed/i.test(m)) return 'هذا البريد غير مسجّل في اللوحة.';
  if (/network|fetch/i.test(m)) return 'تعذّر الاتصال بالخادم، تحقق من الشبكة.';
  return m;
}

export default function Login() {
  const { session, loading } = useSession();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<string | null>(null);
  const from = (loc.state as { from?: string } | null)?.from ?? '/bookings';
  if (!loading && session) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) setError(arabicAuth(error.message));
  }
  async function forgot() {
    if (!email.trim()) return setError('اكتب بريدك أولًا.');
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/set-password` });
    setBusy(false);
    if (error) setError(arabicAuth(error.message));
    else setReset('إن كان البريد مسجّلًا فستصلك رسالة لتعيين كلمة المرور. افتح الرسالة الأحدث واضغط «متابعة».');
  }

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm reveal" aria-labelledby="login-title">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 id="login-title" className="text-xl font-bold mb-1 text-center">لوحة التحكم</h1>
        <p className="text-sm text-ink-muted text-center mb-6">تسجيل الدخول للفريق</p>
        <label className="label" htmlFor="email">البريد الإلكتروني</label>
        <input id="email" className="field latin mb-4" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="label" htmlFor="password">كلمة المرور</label>
        <input id="password" className="field latin mb-2" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox error={error} />
        {reset && <p className="text-sm text-ok my-3">{reset}</p>}
        <button type="submit" className="btn btn-primary w-full mt-3" disabled={busy}>
          {busy && <Spinner />} دخول
        </button>
        <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={forgot} disabled={busy}>
          نسيت كلمة المرور
        </button>
      </form>
    </main>
  );
}
