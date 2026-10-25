// TOTP two-step (Q8): required for admin / management / sales (the data policies read nothing below aal2), optional
// for reception. Enrol once (QR + code), then verify on every sign-in.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ErrorBox, Loading, Spinner } from '../components/ui';
import { west } from '../lib/format';

export default function Mfa() {
  const { me, refresh, signOut } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const from = (loc.state as { from?: string } | null)?.from ?? '/bookings';

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === 'verified');
      if (verified) setFactorId(verified.id);
      else {
        // remove stale unverified factors, then enrol
        for (const f of data?.totp.filter((x) => x.status !== 'verified') ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
        const { data: enr, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'لوحة أرمادا' });
        if (error) setError(error.message);
        else {
          setFactorId(enr.id);
          setQr(enr.totp.qr_code);
          setSecret(enr.totp.secret);
        }
      }
      setLoading(false);
    })();
  }, []);

  async function verify() {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1) {
      setBusy(false);
      return setError(e1.message);
    }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: west(code).replace(/\D/g, '') });
    setBusy(false);
    if (e2) return setError('الرمز غير صحيح أو انتهت صلاحيته.');
    await refresh();
    nav(from, { replace: true });
  }

  if (loading) return <Loading />;
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="card p-8 w-full max-w-sm reveal">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-2 text-center">التحقق بخطوتين</h1>
        {qr ? (
          <>
            <p className="text-sm text-ink-muted mb-4">امسح الرمز بتطبيق المصادقة (Google Authenticator أو Microsoft Authenticator) ثم أدخل الرمز المكوّن من 6 أرقام.</p>
            <img src={qr} alt="رمز QR للتفعيل" className="mx-auto size-44 bg-white p-2 rounded" />
            {secret && <p className="latin text-[11px] text-ink-muted text-center mt-2 break-all select-all" dir="ltr">{secret}</p>}
          </>
        ) : (
          <p className="text-sm text-ink-muted mb-4">{me?.role === 'reception' ? 'أدخل رمز تطبيق المصادقة.' : 'حسابك يتطلب رمز تطبيق المصادقة عند كل دخول.'}</p>
        )}
        <label className="label mt-4" htmlFor="code">الرمز</label>
        <input id="code" className="field num text-center text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(west(e.target.value).replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && verify()} />
        <ErrorBox error={error} />
        <button type="button" className="btn btn-primary w-full mt-3" onClick={verify} disabled={busy || code.length < 6}>
          {busy && <Spinner />} تحقق
        </button>
        <button type="button" className="btn btn-ghost w-full mt-2 btn-sm" onClick={signOut}>
          تسجيل الخروج
        </button>
      </div>
    </main>
  );
}
