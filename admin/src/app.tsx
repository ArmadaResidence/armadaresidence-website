// Routes + the auth gate. Order of gates: no session → /login; session but no staff row → "no access";
// TOTP required but not passed → /mfa; a screen the matrix does not grant → the first granted screen (phase 2a.1:
// the matrix, not the role, decides what shows). A staff user with an empty matrix sees «لا صلاحية».
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { canView } from './lib/api';
import { ToastProvider, Loading } from './components/ui';
import Shell from './components/Shell';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import Mfa from './pages/Mfa';
import Bookings from './pages/Bookings';
import Calendar from './pages/Calendar';
import Rooms from './pages/Rooms';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Audit from './pages/Audit';

const SCREENS: { path: string; section: string }[] = [
  { path: 'bookings', section: 'bookings' },
  { path: 'rates', section: 'rates' },
  { path: 'inventory', section: 'inventory' },
  { path: 'rooms', section: 'rooms' },
  { path: 'settings', section: 'settings' },
  { path: 'users', section: 'users' },
  { path: 'audit', section: 'audit' },
];

function Gate({ children }: { children: React.ReactNode }) {
  const { session, me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (!me) return <NoAccess />;
  if (me.needs_mfa && loc.pathname !== '/mfa') return <Navigate to="/mfa" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** The first screen the matrix grants, or null. */
function Home() {
  const { me } = useSession();
  const first = SCREENS.find((s) => canView(me, s.section));
  return first ? <Navigate to={`/${first.path}`} replace /> : <NoAccess sectionless />;
}

function Allowed({ section, children }: { section: string; children: React.ReactNode }) {
  const { me } = useSession();
  if (canView(me, section)) return <>{children}</>;
  return <Home />;
}

function NoAccess({ sectionless }: { sectionless?: boolean }) {
  const { signOut } = useSession();
  return (
    <main className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="card p-8 max-w-md">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-2">لا صلاحية لهذا الحساب</h1>
        <p className="text-ink-muted text-sm mb-6">{sectionless ? 'حسابك مفعّل لكن بلا صلاحية على أي قسم. تواصل مع مدير النظام.' : 'هذا الحساب غير مفعّل في اللوحة. تواصل مع مدير النظام.'}</p>
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
                    <Route index element={<Home />} />
                    <Route path="bookings" element={<Allowed section="bookings"><Bookings /></Allowed>} />
                    <Route path="rates" element={<Allowed section="rates"><Calendar mode="rates" /></Allowed>} />
                    <Route path="inventory" element={<Allowed section="inventory"><Calendar mode="inventory" /></Allowed>} />
                    <Route path="rooms" element={<Allowed section="rooms"><Rooms /></Allowed>} />
                    <Route path="settings" element={<Allowed section="settings"><Settings /></Allowed>} />
                    <Route path="users" element={<Allowed section="users"><Users /></Allowed>} />
                    <Route path="audit" element={<Allowed section="audit"><Audit /></Allowed>} />
                    <Route path="*" element={<Home />} />
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
