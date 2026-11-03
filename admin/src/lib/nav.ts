// The dashboard's sections and where they sit in the sidebar (Ahmed, 2 Nov 2026 — phase 2b session 3, part D). Each user
// sees only the items their permission matrix grants (view or more); an empty group is hidden. Groups planned for later
// modules (النظرة العامة، الشركاء، التقارير) appear as soon as their first item is added here. 3 Nov 2026: «الأسئلة الشائعة»
// under «المحتوى والتسويق».
import type { IconName } from '../components/icons';
import { canView, type Me } from './api';

export interface NavItem {
  to: string;
  label: string;
  section: string;
  icon: IconName;
}
export interface NavGroup {
  key: string;
  /** null: no heading (النظرة العامة) */
  title: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { key: 'overview', title: null, items: [] },
  {
    key: 'operations',
    title: 'التشغيل',
    items: [
      { to: '/bookings', label: 'الحجوزات', section: 'bookings', icon: 'bookings' },
      { to: '/rates', label: 'الأسعار', section: 'rates', icon: 'rates' },
      { to: '/inventory', label: 'المخزون', section: 'inventory', icon: 'inventory' },
      { to: '/rooms', label: 'الغرف', section: 'rooms', icon: 'rooms' },
    ],
  },
  {
    key: 'content',
    title: 'المحتوى والتسويق',
    items: [
      { to: '/media', label: 'الصور', section: 'media', icon: 'media' },
      { to: '/offers', label: 'العروض', section: 'offers', icon: 'offers' },
      { to: '/dining', label: 'المطاعم', section: 'dining', icon: 'dining' },
      { to: '/blog', label: 'المدونة', section: 'blog', icon: 'blog' },
      { to: '/faq', label: 'الأسئلة الشائعة', section: 'content', icon: 'faq' },
    ],
  },
  { key: 'partners', title: 'الشركاء', items: [] },
  { key: 'reports', title: 'التقارير', items: [] },
  {
    key: 'admin',
    title: 'الإدارة',
    items: [
      { to: '/users', label: 'المستخدمون والصلاحيات', section: 'users', icon: 'users' },
      { to: '/settings', label: 'الإعدادات', section: 'settings', icon: 'settings' },
      { to: '/audit', label: 'السجل', section: 'audit', icon: 'audit' },
    ],
  },
];

export const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** the groups this user sees: only granted items, no empty group */
export function visibleGroups(me: Me | null): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canView(me, i.section)) })).filter((g) => g.items.length);
}

/** the sidebar item a path belongs to (/blog/abc → المدونة) */
export function itemOf(pathname: string): NavItem | undefined {
  return ALL_ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
}

/** pages outside the sidebar that still have a title */
export const EXTRA_TITLES: Record<string, string> = { '/security': 'الأمان' };

export const docTitle = (page: string) => `${page} | لوحة أرمادا`;

// ── the last section visited (until the overview page exists, sign-in lands there) ──
const lastKey = (email: string | null | undefined) => `armada-last-section:${email ?? ''}`;
export function rememberSection(email: string | null | undefined, path: string) {
  try {
    localStorage.setItem(lastKey(email), path);
  } catch { /* private mode */ }
}
export function lastSection(me: Me | null): string | null {
  try {
    const p = localStorage.getItem(lastKey(me?.email));
    const it = p ? itemOf(p) : undefined;
    return it && canView(me, it.section) ? it.to : null;
  } catch {
    return null;
  }
}

// ── per-user preferences kept in this browser (conveniences only) ──
export interface NavPrefs {
  collapsed: boolean;
  /** browser notifications for new booking requests (off by default) */
  notify: boolean;
  /** a short sound for new booking requests (off by default) */
  sound: boolean;
}
const prefsKey = (email: string | null | undefined) => `armada-nav:${email ?? ''}`;
export function readPrefs(email: string | null | undefined): NavPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(prefsKey(email)) ?? '{}') as Partial<NavPrefs>;
    return { collapsed: !!v.collapsed, notify: !!v.notify, sound: !!v.sound };
  } catch {
    return { collapsed: false, notify: false, sound: false };
  }
}
export function writePrefs(email: string | null | undefined, p: NavPrefs) {
  try {
    localStorage.setItem(prefsKey(email), JSON.stringify(p));
  } catch { /* private mode */ }
}
