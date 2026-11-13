// The dashboard's sections and where they sit in the sidebar (Ahmed, 2 Nov 2026 — phase 2b session 3, part D). Each user
// sees only the items their permission matrix grants (view or more); an empty group is hidden. «النظرة العامة» and
// «التقارير» head the list without a group label (4 Nov 2026). 3 Nov 2026: «المحتوى» and «الأسئلة
// الشائعة» under «المحتوى والتسويق», «طلبات الشركاء» under «الشركاء».
import type { IconName } from '../components/icons';
import { canView, type Me } from './api';

export interface NavItem {
  to: string;
  label: string;
  section: string;
  icon: IconName;
  /** data-nav when two items share a section (المحتوى / الأسئلة الشائعة, both under content) */
  id?: string;
}
export interface NavGroup {
  key: string;
  /** null: no heading (النظرة العامة) */
  title: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  // «النظرة العامة» and «التقارير» at the top without a group label (Ahmed, 4 Nov 2026 — session 6)
  {
    key: 'overview',
    title: null,
    items: [
      { to: '/overview', label: 'النظرة العامة', section: 'overview', icon: 'overview' },
      { to: '/reports', label: 'التقارير', section: 'reports', icon: 'reports' },
    ],
  },
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
      { to: '/content', label: 'المحتوى', section: 'content', icon: 'content' },
      { to: '/faq', label: 'الأسئلة الشائعة', section: 'content', icon: 'faq', id: 'faq' },
      // «آراء الضيوف» (7 Nov 2026): the home page's guest reviews, under the content permission as the FAQ
      { to: '/reviews', label: 'آراء الضيوف', section: 'content', icon: 'reviews', id: 'reviews' },
      // «شعارات الشركاء» (7 Nov 2026): the home page's partner logo strip, under the content permission as the reviews
      { to: '/partner-logos', label: 'شعارات الشركاء', section: 'content', icon: 'logos', id: 'partner-logos' },
      // «العملاء» (3 Nov 2026): guest profiles, the club, consents and the audience exports
      { to: '/guests', label: 'العملاء', section: 'guests', icon: 'guests' },
      // «عروض إياب على واتساب» (9 Nov 2026): eyab_offer campaigns to the members, from a branch number
      { to: '/eyab-whatsapp', label: 'عروض إياب على واتساب', section: 'eyab_wa', icon: 'whatsapp' },
    ],
  },
  // «مركز الضيوف» (13 Nov 2026, Guest Hub H1): «المحادثات» (H3) then «إعدادات المساعد»; knowledge, radar and «الآن» join
  // in their sessions (sections inbox / knowledge / radar / now exist since H1)
  {
    key: 'hub',
    title: 'مركز الضيوف',
    items: [
      { to: '/inbox', label: 'المحادثات', section: 'inbox', icon: 'inbox' },
      { to: '/assistant', label: 'إعدادات المساعد', section: 'assistant', icon: 'assistant' },
    ],
  },
  {
    key: 'partners',
    title: 'الشركاء',
    items: [{ to: '/partners', label: 'طلبات الشركاء', section: 'partners', icon: 'partners' }],
  },
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

// ── where sign-in lands (Ahmed, 4 Nov 2026): «النظرة العامة» for those who hold it, else «الحجوزات», else the first
// granted screen (replaces the last-section landing of 3 Nov 2026) ──
export function landing(me: Me | null): string | null {
  if (canView(me, 'overview')) return '/overview';
  if (canView(me, 'bookings')) return '/bookings';
  return ALL_ITEMS.find((i) => canView(me, i.section))?.to ?? null;
}

// ── per-user preferences kept in this browser (conveniences only) ──
export interface NavPrefs {
  collapsed: boolean;
  /** browser notifications for new booking requests (off by default) */
  notify: boolean;
  /** a short sound for new booking requests (off by default) */
  sound: boolean;
  /** «المحادثات» (H3): a browser notification / a sound when a conversation waits for staff (off by default) */
  hubNotify: boolean;
  hubSound: boolean;
}
const prefsKey = (email: string | null | undefined) => `armada-nav:${email ?? ''}`;
export function readPrefs(email: string | null | undefined): NavPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(prefsKey(email)) ?? '{}') as Partial<NavPrefs>;
    return { collapsed: !!v.collapsed, notify: !!v.notify, sound: !!v.sound, hubNotify: !!v.hubNotify, hubSound: !!v.hubSound };
  } catch {
    return { collapsed: false, notify: false, sound: false, hubNotify: false, hubSound: false };
  }
}
export function writePrefs(email: string | null | undefined, p: NavPrefs) {
  try {
    localStorage.setItem(prefsKey(email), JSON.stringify(p));
  } catch { /* private mode */ }
}
