// Landing page of the invite and the password-reset links (Supabase Auth → /set-password). The session arrives
// through the URL (PKCE); the user sets a password and continues.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ErrorBox, Spinner } from '../components/ui';

export default function SetPassword() {
  const { session, loading, refresh } = useSession();
  const nav = useNavigate();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // the auth code in the URL becomes a session; give the client a moment
    const t = setTimeout(() => setReady(true), 800);
    return () => clearTimeout(t);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (p1.length < 10) return setError('كلمة المرور 10 أحرف على الأقل.');
    if (p1 !== p2) return setError('كلمتا المرور غير متطابقتين.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) return setError(error.message);
    await refresh();
    nav('/bookings', { replace: true });
  }

  const noSession = ready && !loading && !session;
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm reveal">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-6 text-center">تعيين كلمة المرور</h1>
        {noSession ? (
          <p className="text-sm text-error">الرابط غير صالح أو منتهي. اطلب رابطًا جديدًا من مدير النظام أو من «نسيت كلمة المرور».</p>
        ) : (
          <>
            <label className="label" htmlFor="p1">كلمة المرور الجديدة</label>
            <input id="p1" className="field latin mb-4" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={p1} onChange={(e) => setP1(e.target.value)} />
            <label className="label" htmlFor="p2">تأكيد كلمة المرور</label>
            <input id="p2" className="field latin mb-2" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={p2} onChange={(e) => setP2(e.target.value)} />
            <ErrorBox error={error} />
            <button type="submit" className="btn btn-primary w-full mt-3" disabled={busy || !session}>
              {busy && <Spinner />} حفظ والمتابعة
            </button>
          </>
        )}
      </form>
    </main>
  );
}
