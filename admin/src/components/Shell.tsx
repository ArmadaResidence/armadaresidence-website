// App frame (Ahmed, 2 Nov 2026 — phase 2b session 3, part D; replaces the one-line top nav and the phone tab bar):
//   - a sidebar on the start side (right in Arabic), grouped (lib/nav.ts), an icon per item, only the items the user's
//     permission matrix grants, empty groups hidden, labels never wrapped. From md it collapses to icons (remembered per
//     user, a tooltip on hover / focus); on phones it is a drawer opened from the top bar (a modal: focus kept inside,
//     Esc or × closes it, an outside press never does).
//   - the account menu at the bottom: name and role, «الأمان», light / dark, the opt-in alerts for new booking requests
//     (browser notification, sound — off by default), «خروج».
//   - a slim top bar with the page title (and its breadcrumb when the page has levels — usePageCrumbs) and the quick
//     search (Ctrl+K / ⌘K). The document title is «{page} | لوحة أرمادا».
//   - the live «الحجوزات» and «طلبات الشركاء» badges (lib/live.ts, Realtime under RLS).
//   - «؟» «المساعدة» next to the search and the guided tour (components/Tour.tsx, 4 Nov 2026); the controls it points at
//     carry `data-tour` tokens.
// Every link goes through the leave guard (unsaved edits ask first). Landmarks: banner, navigation, main; aria-current on
// the current item; visible focus; RTL; light and dark.
import UpdateBar from './UpdateBar';
import { NavLink, useLocation } from 'react-router-dom';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../lib/session';
import { canView } from '../lib/api';
import { BRANCH_NAMES, ROLE_LABELS } from '../lib/format';
import { docTitle, EXTRA_TITLES, itemOf, readPrefs, visibleGroups, writePrefs, type NavGroup, type NavPrefs } from '../lib/nav';
import { useBookingBadge, useHubBadge, usePartnersBadge } from '../lib/live';
import { onOutsidePress } from '../../../src/lib/client';
import { useLeaveGuard } from './ui';
import { Icon } from './icons';
import QuickSearch from './QuickSearch';
import { HelpMenu, TourProvider } from './Tour';

// ── the page title and breadcrumb a page may set (pages with levels: the blog editor…) ──
export interface Crumb {
  label: string;
  to?: string;
}
const CrumbCtx = createContext<(c: Crumb[] | null) => void>(() => {});
/** a page with levels names them: [{label: 'المدونة', to: '/blog'}, {label: 'تعديل مقال'}]; null = the section's name */
export function usePageCrumbs(crumbs: Crumb[] | null) {
  const set = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    return () => set(null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// one light / dark setting (<html data-theme>, remembered in localStorage) shared by the top-bar toggle and the account
// menu item (3 Nov 2026): every user of the hook re-renders when either changes it
const themeListeners = new Set<() => void>();
const readTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function useTheme() {
  const theme = useSyncExternalStore((cb) => {
    themeListeners.add(cb);
    return () => themeListeners.delete(cb);
  }, readTheme);
  const toggle = useCallback(() => {
    const next = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('armada-theme', next);
    } catch { /* private mode */ }
    themeListeners.forEach((f) => f());
  }, []);
  return [theme, toggle] as const;
}

/** The top bar's light / dark switch (sun / moon, 44 px), next to the search on every width. */
function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن';
  return (
    <button type="button" className="topbar-theme" onClick={toggle} aria-pressed={theme === 'dark'} aria-label={label} data-action="theme-top">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
      <span className="topbar-tip" role="tooltip" aria-hidden="true">{label}</span>
    </button>
  );
}

function NavList({ groups, collapsed, badges, onGo }: { groups: NavGroup[]; collapsed: boolean; badges: Record<string, number | null>; onGo?: () => void }) {
  const guard = useLeaveGuard();
  return (
    <nav aria-label="الأقسام" className="side-nav" data-side-nav>
      {groups.map((g) => (
        <div key={g.key} className="side-group" data-nav-group={g.key}>
          {g.title && (collapsed ? <hr className="side-rule" aria-hidden="true" /> : <p className="side-group-title" id={`nav-g-${g.key}`}>{g.title}</p>)}
          <ul aria-labelledby={g.title && !collapsed ? `nav-g-${g.key}` : undefined}>
            {g.items.map((i) => {
              const n = badges[i.section] ?? null;
              return (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    className={({ isActive }) => `side-link ${isActive ? 'is-on' : ''}`}
                    onClick={(e) => {
                      guard.link(e, i.to);
                      onGo?.();
                    }}
                    data-nav={i.id ?? i.section}
                    data-tour={`nav-${i.id ?? i.section}`}
                  >
                    <span className="side-icon">
                      <Icon name={i.icon} size={20} />
                      {collapsed && n ? <span className="side-dot" aria-hidden="true" /> : null}
                    </span>
                    <span className="side-label">
                      {i.label}
                      {n ? <span className="sr-only">{`، ${n} طلب ينتظر الإجراء`}</span> : null}
                    </span>
                    {n && !collapsed ? <span className="side-badge num" aria-hidden="true" data-badge={i.section}>{n > 99 ? '99+' : n}</span> : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AccountMenu({ collapsed, prefs, setPrefs, onGo }: { collapsed: boolean; prefs: NavPrefs; setPrefs: (p: NavPrefs) => void; onGo?: () => void }) {
  const { me, signOut } = useSession();
  const guard = useLeaveGuard();
  const [theme, toggle] = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  useEffect(() => onOutsidePress(() => [root.current], () => setOpen(false), { active: () => open }), [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setOpen(false);
        root.current?.querySelector<HTMLElement>('[data-action="account-menu"]')?.focus();
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]);
  const canBookings = canView(me, 'bookings');
  const canInbox = canView(me, 'inbox');
  const askNotify = async (on: boolean, key: 'notify' | 'hubNotify' = 'notify') => {
    if (on && 'Notification' in window && Notification.permission === 'default') setPerm(await Notification.requestPermission());
    setPrefs({ ...prefs, [key]: on });
  };
  const role = me ? `${ROLE_LABELS[me.role] ?? me.role}${me.branch ? ` · ${BRANCH_NAMES[me.branch] ?? me.branch}` : ''}` : '';
  return (
    <div className="side-account" ref={root}>
      <button type="button" className="side-link side-account-btn" aria-expanded={open} aria-controls="account-panel" onClick={() => setOpen((v) => !v)} data-action="account-menu">
        <span className="side-icon"><Icon name="user" size={20} /></span>
        <span className="side-label side-account-text">
          <span className="block truncate font-semibold">{me?.full_name}</span>
          <span className="block truncate text-xs opacity-80">{role}</span>
        </span>
        {!collapsed && <Icon name="chevron" size={16} className={`side-chevron ${open ? '' : 'is-up'}`} />}
      </button>
      {open && (
        <div id="account-panel" className="account-panel" data-account-panel>
          {collapsed && (
            <div className="px-3 pt-2 pb-1">
              <p className="font-semibold text-sm truncate">{me?.full_name}</p>
              <p className="text-xs text-ink-muted truncate">{role}</p>
            </div>
          )}
          <NavLink to="/security" className="account-item" data-nav="security" onClick={(e) => { guard.link(e, '/security'); setOpen(false); onGo?.(); }}>
            <Icon name="security" size={18} /> الأمان
          </NavLink>
          <button type="button" className="account-item" onClick={toggle} aria-pressed={theme === 'dark'} data-action="theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /> {theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          </button>
          {canBookings && (
            <fieldset className="account-alerts">
              <legend className="text-xs font-bold text-ink-muted px-3 pt-2">تنبيه بطلبات الحجز الجديدة</legend>
              <label className="account-check">
                <input type="checkbox" checked={prefs.notify && perm === 'granted'} disabled={perm === 'denied'} onChange={(e) => void askNotify(e.target.checked)} data-pref="notify" data-no-dirty />
                <span>إشعار المتصفح{perm === 'denied' ? ' (محظور في إعدادات المتصفح)' : ''}</span>
              </label>
              <label className="account-check">
                <input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ ...prefs, sound: e.target.checked })} data-pref="sound" data-no-dirty />
                <span>صوت التنبيه</span>
              </label>
              <p className="text-[11px] text-ink-muted px-3 pb-1">أثناء فتح اللوحة فقط؛ رقم الحجز والفرع دون بيانات الضيف.</p>
            </fieldset>
          )}
          {canInbox && (
            <fieldset className="account-alerts" data-hub-alerts-prefs>
              <legend className="text-xs font-bold text-ink-muted px-3 pt-2">تنبيه بالمحادثات المنتظرة</legend>
              <label className="account-check">
                <input type="checkbox" checked={prefs.hubNotify && perm === 'granted'} disabled={perm === 'denied'} onChange={(e) => void askNotify(e.target.checked, 'hubNotify')} data-pref="hubNotify" data-no-dirty />
                <span>إشعار المتصفح{perm === 'denied' ? ' (محظور في إعدادات المتصفح)' : ''}</span>
              </label>
              <label className="account-check">
                <input type="checkbox" checked={prefs.hubSound} onChange={(e) => setPrefs({ ...prefs, hubSound: e.target.checked })} data-pref="hubSound" data-no-dirty />
                <span>صوت التنبيه</span>
              </label>
              <p className="text-[11px] text-ink-muted px-3 pb-1">أثناء فتح اللوحة فقط؛ اسم الوحدة دون كلام الضيف أو رقمه.</p>
            </fieldset>
          )}
          <button type="button" className="account-item" onClick={() => guard.run(() => void signOut())} data-action="sign-out">
            <Icon name="logout" size={18} /> خروج
          </button>
        </div>
      )}
    </div>
  );
}

/** the phone drawer: a modal panel on the start side; Esc and × close it, an outside press never does */
function NavDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const behind = [document.getElementById('app-main'), document.getElementById('app-topbar')];
    behind.forEach((el) => el?.setAttribute('inert', ''));
    ref.current?.querySelector<HTMLElement>('[data-action="nav-close"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      behind.forEach((el) => el?.removeAttribute('inert'));
      opener?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="nav-drawer-backdrop" onMouseDown={(e) => e.preventDefault()} data-nav-backdrop />
      <div ref={ref} className="nav-drawer sidebar" role="dialog" aria-modal="true" aria-label="القائمة" data-nav-drawer>
        <div className="flex items-center justify-between gap-2 px-3 h-14">
          <img src={`${import.meta.env.BASE_URL}logo-porcelain.svg`} alt="أرمادا ريزيدنس" className="h-7" />
          <button type="button" className="side-icon-btn" onClick={onClose} aria-label="إغلاق القائمة" data-action="nav-close"><Icon name="close" size={20} /></button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { pathname } = useLocation();
  const [prefs, setPrefsState] = useState<NavPrefs>(() => readPrefs(me?.email));
  const setPrefs = useCallback((p: NavPrefs) => {
    setPrefsState(p);
    writePrefs(me?.email, p);
  }, [me?.email]);
  useEffect(() => setPrefsState(readPrefs(me?.email)), [me?.email]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const badge = useBookingBadge(me, () => prefsRef.current);
  const partnersBadge = usePartnersBadge(me);
  const hubBadge = useHubBadge(me, () => prefsRef.current);
  const badges = useMemo(() => ({ bookings: badge, partners: partnersBadge, inbox: hubBadge }), [badge, partnersBadge, hubBadge]);
  const groups = useMemo(() => visibleGroups(me), [me]);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const item = itemOf(pathname);
  const page = crumbs?.at(-1)?.label ?? item?.label ?? EXTRA_TITLES[pathname] ?? 'لوحة أرمادا';
  useEffect(() => {
    document.title = docTitle(page);
  }, [page]);
  useEffect(() => setDrawer(false), [pathname]);
  // Ctrl+K / ⌘K
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        setSearch(true);
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const collapsed = prefs.collapsed;
  const trail: Crumb[] = crumbs ?? (item ? [{ label: item.label }] : [{ label: page }]);
  return (
    <CrumbCtx.Provider value={setCrumbs}>
      <TourProvider>
      <div className={`app-frame ${collapsed ? 'is-collapsed' : ''}`}>
        <a href="#app-main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 btn btn-primary">إلى المحتوى</a>
        <div className={`sidebar side-fixed ${collapsed ? 'is-collapsed' : ''}`} data-sidebar data-collapsed={collapsed ? '1' : '0'} data-tour="sidebar">
          <div className="side-brand">
            {collapsed
              ? <img src={`${import.meta.env.BASE_URL}symbol.svg`} alt="أرمادا ريزيدنس" className="h-8 w-8" />
              : <img src={`${import.meta.env.BASE_URL}logo-porcelain.svg`} alt="أرمادا ريزيدنس" className="h-8" />}
          </div>
          <NavList groups={groups} collapsed={collapsed} badges={badges} />
          <div className="side-foot">
            <button type="button" className="side-link" onClick={() => setPrefs({ ...prefs, collapsed: !collapsed })} aria-pressed={collapsed} data-action="nav-collapse">
              <span className="side-icon"><Icon name="collapse" size={20} className={collapsed ? 'flip-x' : ''} /></span>
              <span className="side-label">{collapsed ? 'توسيع القائمة' : 'طيّ القائمة'}</span>
            </button>
            <AccountMenu collapsed={collapsed} prefs={prefs} setPrefs={setPrefs} />
          </div>
        </div>
        <div className="app-col">
          <header id="app-topbar" className="topbar">
            <button type="button" className="side-icon-btn md:hidden" onClick={() => setDrawer(true)} aria-label="القائمة" aria-expanded={drawer} aria-haspopup="dialog" data-action="nav-open" data-tour="nav-open">
              <Icon name="menu" size={22} />
              {badge || partnersBadge || hubBadge ? <span className="side-dot" aria-hidden="true" /> : null}
            </button>
            {trail.length > 1 ? (
              <nav aria-label="مسار الصفحة" className="topbar-title min-w-0" data-breadcrumb>
                <ol className="flex items-center gap-1.5 min-w-0">
                  {trail.map((c, i) => (
                    <li key={i} className="flex items-center gap-1.5 min-w-0">
                      {i > 0 && <span aria-hidden="true" className="text-ink-muted">‹</span>}
                      {c.to && i < trail.length - 1 ? <NavLink to={c.to} className="link truncate">{c.label}</NavLink> : <span className="truncate" aria-current={i === trail.length - 1 ? 'page' : undefined}>{c.label}</span>}
                    </li>
                  ))}
                </ol>
              </nav>
            ) : (
              <p className="topbar-title truncate" data-page-title>{trail[0].label}</p>
            )}
            <button type="button" className="topbar-search ms-auto" onClick={() => setSearch(true)} aria-keyshortcuts="Control+K Meta+K" data-action="quick-search">
              <Icon name="search" size={18} />
              <span className="max-sm:sr-only">بحث</span>
              <kbd className="max-md:hidden num" aria-hidden="true">Ctrl K</kbd>
            </button>
            <HelpMenu />
            <ThemeToggle />
          </header>
          <UpdateBar />
          <main id="app-main" className="flex-1 w-full max-w-7xl mx-auto px-4 py-5 pb-10">{children}</main>
        </div>
        <NavDrawer open={drawer} onClose={closeDrawer}>
          <NavList groups={groups} collapsed={false} badges={badges} onGo={closeDrawer} />
          <div className="side-foot">
            <AccountMenu collapsed={false} prefs={prefs} setPrefs={setPrefs} onGo={closeDrawer} />
          </div>
        </NavDrawer>
        <QuickSearch open={search} onClose={() => setSearch(false)} />
      </div>
      </TourProvider>
    </CrumbCtx.Provider>
  );
}
