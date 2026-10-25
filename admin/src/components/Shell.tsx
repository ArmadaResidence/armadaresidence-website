// App frame: brand header, navigation by role, theme toggle, sign-out. Mobile-first: a bottom tab bar under md,
// a top nav from md. RTL throughout (the dashboard is Arabic-only in phase 2a).
import { NavLink } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, ROLE_LABELS } from '../lib/format';

const NAV: { to: string; label: string; roles?: string[] }[] = [
  { to: '/bookings', label: 'الحجوزات' },
  { to: '/rates', label: 'الأسعار' },
  { to: '/inventory', label: 'المخزون' },
  { to: '/settings', label: 'الإعدادات', roles: ['admin', 'management', 'sales'] },
  { to: '/users', label: 'المستخدمون', roles: ['admin'] },
  { to: '/audit', label: 'السجل' },
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
  const items = NAV.filter((n) => !n.roles || (me && n.roles.includes(me.role)));
  const cls = ({ isActive }: { isActive: boolean }) => `px-3 py-2 rounded text-sm font-semibold transition-colors ${isActive ? 'bg-bronze-deep text-white' : 'text-porcelain/85 hover:bg-white/10'}`;
  return (
    <div className="min-h-dvh flex flex-col">
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
            <button type="button" className="btn btn-sm border border-porcelain/30 text-porcelain hover:bg-white/10" onClick={toggle} aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button type="button" className="btn btn-sm border border-porcelain/30 text-porcelain hover:bg-white/10" onClick={signOut}>
              خروج
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-5 pb-24 md:pb-8">{children}</main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-midnight text-porcelain border-t border-white/10 flex justify-around py-1 pb-[max(4px,env(safe-area-inset-bottom))] z-30" aria-label="الأقسام">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex-1 text-center text-[11px] font-semibold py-2 rounded ${isActive ? 'text-bronze-bright' : 'text-porcelain/80'}`}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
