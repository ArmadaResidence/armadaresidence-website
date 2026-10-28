// Routes + the auth gate. Order of gates: still resolving → a neutral splash (never a wrong state, 26 Oct 2026);
// my_staff() failed → «تعذّر الاتصال» with retry; no session → /login; no staff row or inactive → "no access";
// the second step not passed → /code (phase 2a.2: the email code, for everyone; /mfa redirects there); an admin
// without backup codes → /backup-codes once per tab («لاحقًا» continues); a screen the matrix does not grant → the
// first granted screen (phase 2a.1: the matrix, not the role, decides what shows). An empty matrix sees «لا صلاحية».
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { canView } from './lib/api';
import { LeaveGuardProvider, ToastProvider, Splash } from './components/ui';
import Shell from './components/Shell';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import Code from './pages/Code';
import BackupCodes, { BACKUP_LATER_KEY } from './pages/BackupCodes';
import Security from './pages/Security';
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
  const { session, me, status, refresh } = useSession();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (status === 'error') return <Unreachable onRetry={refresh} />;
  if (!me || !me.active) return <NoAccess />;
  if (me.needs_second_factor) {
    if (loc.pathname !== '/code') return <Navigate to="/code" replace state={{ from: loc.pathname + loc.search }} />;
  } else if (me.is_admin && me.backup_codes_left === 0 && loc.pathname !== '/backup-codes' && loc.pathname !== '/code' && !backupLater()) {
    return <Navigate to="/backup-codes" replace state={{ from: loc.pathname + loc.search }} />;
  }
  return <>{children}</>;
}

/** «لاحقًا» on the backup-codes page: this tab continues without codes (reminded at the next sign-in) */
function backupLater(): boolean {
  try {
    return sessionStorage.getItem(BACKUP_LATER_KEY) === '1';
  } catch {
    return false;
  }
}

function Unreachable({ onRetry }: { onRetry: () => Promise<void> }) {
  const { signOut } = useSession();
  return (
    <main className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="card p-8 max-w-md" data-state="unreachable">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-2">تعذّر الاتصال بالخادم</h1>
        <p className="text-ink-muted text-sm mb-6">تحقق من الشبكة ثم أعد المحاولة.</p>
        <div className="flex gap-2 justify-center">
          <button type="button" className="btn btn-primary" onClick={() => void onRetry()} data-action="retry">إعادة المحاولة</button>
          <button type="button" className="btn btn-ghost" onClick={signOut}>تسجيل الخروج</button>
        </div>
      </div>
    </main>
  );
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
      <div className="card p-8 max-w-md" data-state="no-access">
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
        <LeaveGuardProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/mfa" element={<Navigate to="/code" replace />} />
          <Route
            path="/code"
            element={
              <Gate>
                <Code />
              </Gate>
            }
          />
          <Route
            path="/backup-codes"
            element={
              <Gate>
                <BackupCodes />
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
                    <Route path="security" element={<Security />} />
                    <Route path="*" element={<Home />} />
                  </Routes>
                </Shell>
              </Gate>
            }
          />
        </Routes>
        </LeaveGuardProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
