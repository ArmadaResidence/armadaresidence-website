// Quick search (Ahmed, 2 Nov 2026 — part D): Ctrl+K / ⌘K or the search button. Jumps to any section the user can open
// by its name, and — only for users who can view bookings — finds a booking by its ref, the guest's name or phone (the
// same query as the bookings list, so RLS and the branch scope decide what comes back). A booking opens its details
// in «الحجوزات». A combobox over a listbox: ↑ / ↓ move, Enter opens, Esc / × close (an outside press never closes it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import type { Reservation } from '../lib/api';
import { useSession } from '../lib/session';
import { visibleGroups } from '../lib/nav';
import { BRANCH_NAMES, STATUS_LABELS, west } from '../lib/format';
import { Modal, useLeaveGuard } from './ui';
import { Icon, type IconName } from './icons';

interface Hit {
  id: string;
  kind: 'section' | 'booking';
  label: string;
  sub?: string;
  icon: IconName;
  to: string;
}
const norm = (s: string) => west(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

export default function QuickSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useSession();
  const navigate = useNavigate();
  const guard = useLeaveGuard();
  const [q, setQ] = useState('');
  const [bookings, setBookings] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const canBookings = api.canView(me, 'bookings');

  useEffect(() => {
    if (!open) return;
    setQ('');
    setBookings([]);
    setActive(0);
    window.setTimeout(() => input.current?.focus(), 30);
  }, [open]);

  // bookings: debounced, from 2 characters, only for bookings viewers
  useEffect(() => {
    const s = west(q).trim();
    if (!open || !canBookings || s.length < 2) {
      setBookings([]);
      return;
    }
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        setBookings(await api.reservations({ search: s }, 8));
      } catch {
        setBookings([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open, canBookings]);

  const hits = useMemo<Hit[]>(() => {
    const n = norm(q);
    const sections: Hit[] = [...visibleGroups(me).flatMap((g) => g.items), { to: '/security', label: 'الأمان', section: '', icon: 'security' as const }]
      .filter((i) => !n || norm(i.label).includes(n))
      .map((i) => ({ id: `s:${i.to}`, kind: 'section', label: i.label, icon: i.icon, to: i.to }));
    const found: Hit[] = bookings.map((b) => ({
      id: `b:${b.ref}`,
      kind: 'booking',
      label: `${b.ref} · ${b.guest_name}`,
      sub: `${BRANCH_NAMES[b.branch] ?? b.branch} · ${STATUS_LABELS[b.status] ?? b.status} · ${b.check_in}`,
      icon: 'bookings',
      to: `/bookings?ref=${encodeURIComponent(b.ref)}`,
    }));
    return [...found, ...sections];
  }, [q, me, bookings]);

  useEffect(() => setActive(0), [hits.length]);

  const go = (h: Hit) => {
    onClose();
    guard.run(() => navigate(h.to));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };
  const optId = (h: Hit) => `qs-${h.id.replace(/[^a-zA-Z0-9-]/g, '_')}`;

  return (
    <Modal open={open} onClose={onClose} title="بحث سريع">
      <div className="grid gap-3" data-quick-search>
        <label htmlFor="qs-input" className="sr-only">ابحث</label>
        <input
          ref={input}
          id="qs-input"
          className="field"
          type="search"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="qs-list"
          aria-activedescendant={hits[active] ? optId(hits[active]) : undefined}
          aria-autocomplete="list"
          placeholder={canBookings ? 'رقم الحجز أو اسم الضيف أو الجوال، أو اسم قسم…' : 'اسم قسم…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          autoComplete="off"
          data-no-dirty
        />
        <p className="text-xs text-ink-muted" role="status">
          {loading ? 'نبحث في الحجوزات…' : hits.length ? `${hits.length} نتيجة` : 'لا نتائج.'}
        </p>
        <ul id="qs-list" role="listbox" aria-label="النتائج" className="qs-list">
          {hits.map((h, i) => (
            <li key={h.id} id={optId(h)} role="option" aria-selected={i === active} className={`qs-item ${i === active ? 'is-on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseEnter={() => setActive(i)} data-hit={h.kind} data-hit-id={h.id}>
              <Icon name={h.icon} size={18} className="flex-none text-ink-muted" />
              <span className="min-w-0">
                <span className={`block truncate ${h.kind === 'booking' ? 'num' : ''}`}>{h.label}</span>
                {h.sub && <span className="block text-xs text-ink-muted truncate num">{h.sub}</span>}
              </span>
              <span className="ms-auto text-xs text-ink-muted flex-none">{h.kind === 'booking' ? 'حجز' : 'قسم'}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
