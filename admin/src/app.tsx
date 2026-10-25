// Routes + the auth gate. Order of gates: no session → /login; session but no staff row → "no access";
// admin / management / sales without TOTP → /mfa; otherwise the shell with the screens the role may use.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Loading } from './components/ui';
import Shell from './components/Shell';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import Mfa from './pages/Mfa';
import Bookings from './pages/Bookings';
import Calendar from './pages/Calendar';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Audit from './pages/Audit';

function Gate({ children }: { children: React.ReactNode }) {
  const { session, me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (!me) return <NoAccess />;
  if (me.needs_mfa && loc.pathname !== '/mfa') return <Navigate to="/mfa" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function NoAccess() {
  const { signOut } = useSession();
  return (
    <main className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="card p-8 max-w-md">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-2">لا صلاحية لهذا الحساب</h1>
        <p className="text-ink-muted text-sm mb-6">هذا الحساب غير مفعّل في اللوحة. تواصل مع مدير النظام.</p>
        <button type="button" className="btn btn-ghost" onClick={signOut}>تسجيل الخروج</button>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route
            path="/mfa"
            element={
              <Gate>
                <Mfa />
              </Gate>
            }
          />
          <Route
            path="/*"
            element={
              <Gate>
                <Shell>
                  <Routes>
                    <Route index element={<Navigate to="/bookings" replace />} />
                    <Route path="bookings" element={<Bookings />} />
                    <Route path="rates" element={<Calendar mode="rates" />} />
                    <Route path="inventory" element={<Calendar mode="inventory" />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="users" element={<Users />} />
                    <Route path="audit" element={<Audit />} />
                    <Route path="*" element={<Navigate to="/bookings" replace />} />
                  </Routes>
                </Shell>
              </Gate>
            }
          />
        </Routes>
      </SessionProvider>
    </ToastProvider>
  );
}
