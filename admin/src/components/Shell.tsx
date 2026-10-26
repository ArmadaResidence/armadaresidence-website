// App frame: brand header, navigation from the user's permission matrix (phase 2a.1 — a section shows with view or
// edit), theme toggle, sign-out. Mobile-first: a bottom tab bar under md, a top nav from md. RTL throughout.
import { NavLink } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import { canView } from '../lib/api';
import { BRANCH_NAMES, ROLE_LABELS } from '../lib/format';

const NAV: { to: string; label: string; short: string; section: string }[] = [
  { to: '/bookings', label: 'الحجوزات', short: 'الحجوزات', section: 'bookings' },
  { to: '/rates', label: 'الأسعار', short: 'الأسعار', section: 'rates' },
  { to: '/inventory', label: 'المخزون', short: 'المخزون', section: 'inventory' },
  { to: '/rooms', label: 'الغرف', short: 'الغرف', section: 'rooms' },
  { to: '/settings', label: 'الإعدادات', short: 'الإعدادات', section: 'settings' },
  { to: '/users', label: 'المستخدمون والصلاحيات', short: 'المستخدمون', section: 'users' },
  { to: '/audit', label: 'السجل', short: 'السجل', section: 'audit' },
];

function useTheme() {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('armada-theme', theme);
    } catch { /* private mode */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

export default function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useSession();
  const [theme, toggle] = useTheme();
  const items = NAV.filter((n) => canView(me, n.section));
  const cls = ({ isActive }: { isActive: boolean }) => `px-3 py-2 rounded text-sm font-semibold transition-colors ${isActive ? 'bg-bronze-deep text-white' : 'text-porcelain/85 hover:bg-white/10'}`;
  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 btn btn-primary">إلى المحتوى</a>
      <header className="bg-midnight text-porcelain">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-4">
          <img src={`${import.meta.env.BASE_URL}logo-porcelain.svg`} alt="أرمادا ريزيدنس" className="h-8" />
          <nav className="hidden md:flex items-center gap-1 ms-4" aria-label="الأقسام">
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} className={cls}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2 text-xs">
            {me && (
              <span className="hidden sm:inline text-porcelain/80">
                {me.full_name} · {ROLE_LABELS[me.role]}
                {me.branch ? ` · ${BRANCH_NAMES[me.branch] ?? me.branch}` : ''}
              </span>
            )}
            <button type="button" className="btn btn-sm border border-porcelain/30 text-porcelain hover:bg-white/10" onClick={toggle} aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'} aria-pressed={theme === 'dark'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
              </svg>
            </button>
            <NavLink to="/security" className="btn btn-sm border border-porcelain/30 text-porcelain hover:bg-white/10" data-nav="security">
              الأمان
            </NavLink>
            <button type="button" className="btn btn-sm border border-porcelain/30 text-porcelain hover:bg-white/10" onClick={signOut}>
              خروج
            </button>
          </div>
        </div>
      </header>
      <main id="app-main" className="flex-1 mx-auto w-full max-w-7xl px-4 py-5 pb-24 md:pb-8">{children}</main>
      <nav className="tabbar md:hidden fixed bottom-0 inset-x-0 bg-midnight text-porcelain border-t border-white/10 flex justify-around py-1 pb-[max(4px,env(safe-area-inset-bottom))] z-30" aria-label="الأقسام">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex-1 text-center text-[11px] font-semibold py-2 rounded ${isActive ? 'text-bronze-bright' : 'text-porcelain/80'}`}>
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
