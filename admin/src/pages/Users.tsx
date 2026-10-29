// Users and permissions (phase 2a.1, item 6): list, invite, deactivate / activate, resend the invite or a reset link,
// and per user the matrix (section × none / view / edit), the preset («الدور») that prefills it, the branch scope and
// «منح صلاحية كاملة». Reads and the invite / deactivate go through the admin-users function; the matrix, preset and
// scope go through set_permissions (as the caller, one audited batch → «تراجع»). The last active holder of users:edit
// cannot be deactivated or demoted (database rule shown inline). With users = view the screen is read-only.
// Phase 2a.2 (26 Oct 2026): per user the remembered devices, the last email-code sign-in and (admins) the backup codes
// left; «إلغاء الأجهزة المتذكَّرة» (users:edit) ends that user's verified sessions too — not undoable.
import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { Level, Role, Section, StaffUser } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, ROLE_LABELS, riyadhDateTimeLong } from '../lib/format';
import { CancelButton, DirtyScope, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { SECURITY_TEXT as SEC } from '../lib/secondStep';

const LEVELS: { value: Level; label: string }[] = [{ value: 'none', label: 'لا شيء' }, { value: 'view', label: 'عرض' }, { value: 'edit', label: 'تعديل' }];
const ROLES: Role[] = ['admin', 'management', 'sales', 'reception'];

export default function Users() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'users');
  const sections = useMemo(() => [...(me?.sections ?? [])].sort((a, b) => a.sort - b.sort), [me]);
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<StaffUser | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [security, setSecurity] = useState<Record<string, api.StaffSecurity>>({});
  const [revoke, setRevoke] = useState<StaffUser | null>(null);

  const load = async () => {
    try {
      const [u, b, sec] = await Promise.all([api.listUsers(), api.branches(), api.staffSecurity().catch(() => null)]);
      setUsers(u.users);
      setBranches(b);
      setSecurity(Object.fromEntries((sec ?? []).map((x) => [x.user_id, x])));
    } catch (e) {
      setError((e as Error).message);
      setUsers([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  async function act(label: string, id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      toast(label);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  /** a permissions save: undo toast, reload, and refresh my own matrix when it was mine */
  async function savePerms(u: StaffUser, label: string, e: api.PermissionEdit) {
    setBusy(u.user_id);
    try {
      const r = await api.setPermissions(u.user_id, e);
      toast.undo(label, async () => {
        await api.revertBatch(r.batch_id);
        await load();
        await refresh();
      });
      await load();
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  const admins = (users ?? []).filter((u) => u.active && u.permissions?.users === 'edit').length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold me-auto">المستخدمون والصلاحيات</h1>
        {editable && <button type="button" className="btn btn-primary" onClick={() => setInvite(true)} data-action="invite">دعوة مستخدم</button>}
      </div>
      <p className="text-sm text-ink-muted mb-4">لكل مستخدم مصفوفة صلاحيات (لا شيء / عرض / تعديل) لكل قسم، ونطاق فرع (كل الفروع أو فرع واحد). «الدور» قالب يملأ المصفوفة فقط ويمكن تعديلها بعده. {SEC.usersIntro} لا يمكن إيقاف أو تنزيل آخر مدير نظام فعّال.{editable ? '' : ' صلاحيتك هنا للعرض فقط.'}</p>
      <ErrorBox error={error} />
      {users === null ? (
        <Loading />
      ) : (
        <ul className="grid gap-2">
          {users.map((u) => {
            const isLastAdmin = u.active && u.permissions?.users === 'edit' && admins <= 1;
            const isOpen = open === u.user_id;
            return (
              <li key={u.user_id} className="card p-3 sm:p-4" data-user={u.email}>
                <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{u.full_name ?? '—'} <span className="latin text-xs text-ink-muted" dir="ltr">{u.email}</span></div>
                    <div className="text-sm text-ink-muted flex flex-wrap gap-x-2">
                      <span>{u.role ? `القالب: ${ROLE_LABELS[u.role]}` : 'بلا دور'}</span>
                      <span>· {u.branch ? BRANCH_NAMES[u.branch] : 'كل الفروع'}</span>
                      <span>· {u.active ? 'مفعّل' : 'موقوف'}</span>
                      <span>· {u.confirmed ? 'كلمة المرور معيّنة' : 'الدعوة لم تُقبل بعد'}</span>
                      <span data-devices-count={security[u.user_id]?.devices.length ?? 0}>· {SEC.userDevices(security[u.user_id]?.devices.length ?? 0)}</span>
                      {security[u.user_id]?.last_code_at && <span className="num-ar">· {SEC.userLastCode} {riyadhDateTimeLong(security[u.user_id]!.last_code_at!)}</span>}
                      {security[u.user_id]?.backup_codes_left != null && <span className="num-ar">· {SEC.userBackup(security[u.user_id]!.backup_codes_left!)}</span>}
                      {u.permissions?.users === 'edit' && <span className="chip chip-flag">مدير نظام</span>}
                      {u.last_sign_in_at && <span className="num-ar">· آخر دخول {riyadhDateTimeLong(u.last_sign_in_at)}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(isOpen ? null : u.user_id)} aria-expanded={isOpen} data-action="perms">الصلاحيات</button>
                    {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(u)}>الاسم</button>}
                    {editable && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === u.user_id} onClick={() => act('أُرسل الرابط', u.user_id, () => api.resendLink(u.user_id))}>{u.confirmed ? 'رابط كلمة مرور' : 'إعادة الدعوة'}</button>}
                    {editable && u.role && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === u.user_id} onClick={() => setRevoke(u)} data-action="revoke-devices">{SEC.revoke}</button>}
                    {editable && (
                      <button type="button" className={`btn btn-sm ${u.active ? 'btn-danger' : 'btn-primary'}`} disabled={busy === u.user_id || !u.role || isLastAdmin} title={isLastAdmin ? 'آخر مدير نظام فعّال لا يمكن إيقافه' : undefined}
                        onClick={() => act(u.active ? 'أُوقف الحساب' : 'فُعّل الحساب', u.user_id, () => api.updateUser(u.user_id, { active: !u.active }))} data-action="toggle-active">{u.active ? 'إيقاف' : 'تفعيل'}</button>
                    )}
                  </div>
                </div>
                {isOpen && u.role && (
                  <PermissionMatrix user={u} sections={sections} branches={branches} editable={editable} busy={busy === u.user_id} isLastAdmin={isLastAdmin} onSave={(label, e) => savePerms(u, label, e)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!revoke} onClose={() => setRevoke(null)} title={SEC.revoke} busy={!!busy}>
        <p className="text-sm mb-4">{revoke ? SEC.revokeUserBody(revoke.full_name ?? revoke.email) : ''}</p>
        <div className="flex gap-2 justify-end">
          <CancelButton disabled={!!busy} />
          <button type="button" className="btn btn-danger" data-action="revoke-devices-go" disabled={!!busy}
            onClick={() => { const u = revoke!; setRevoke(null); void act(`${SEC.revoked} — ${u.full_name ?? u.email}`, u.user_id, () => api.revokeDevices(u.user_id)); }}>
            {SEC.revokeGo}
          </button>
        </div>
      </Modal>
      {invite && <InviteForm branches={branches} onClose={() => setInvite(false)} onSaved={() => { setInvite(false); toast('أُرسلت الدعوة'); load(); }} />}
      {edit && <NameForm user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('حُفظ'); load(); }} />}
    </div>
  );
}

function PermissionMatrix({ user, sections, branches, editable, busy, isLastAdmin, onSave }: { user: StaffUser; sections: Section[]; branches: api.Branch[]; editable: boolean; busy: boolean; isLastAdmin: boolean; onSave: (label: string, e: api.PermissionEdit) => void }) {
  const [matrix, setMatrix] = useState<Record<string, Level>>({ ...user.permissions });
  const [role, setRole] = useState<Role>(user.role ?? 'reception');
  const [branch, setBranch] = useState<string>(user.branch ?? '');
  const [confirmPreset, setConfirmPreset] = useState(false);
  // re-baseline only when the STORED values change: a reload of the list with the same data (another row's action,
  // StrictMode's second mount fetch) must not wipe an unsaved edit (29 Oct 2026)
  const stored = JSON.stringify([user.permissions, user.role, user.branch]);
  useEffect(() => {
    setMatrix({ ...user.permissions });
    setRole(user.role ?? 'reception');
    setBranch(user.branch ?? '');
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = sections.some((s) => (matrix[s.key] ?? 'none') !== (user.permissions[s.key] ?? 'none'));
  const branchDirty = (branch || null) !== (user.branch ?? null);
  const full = sections.every((s) => (matrix[s.key] ?? 'none') === (s.editable ? 'edit' : 'view'));
  const usersLocked = isLastAdmin; // the last admin keeps users = edit

  return (
    <DirtyScope className="mt-4 border-t border-line pt-4 grid gap-4 lg:grid-cols-[1fr_280px]" data-matrix={user.email} version={`${user.role ?? ''}|${user.branch ?? ''}|${JSON.stringify(user.permissions)}`}>
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-bold text-sm">الصلاحيات حسب القسم</h3>
          {editable && (
            <div className="flex gap-1">
              <button type="button" className="btn btn-ghost btn-sm" disabled={full} onClick={() => setMatrix(Object.fromEntries(sections.map((s) => [s.key, s.editable ? 'edit' : 'view'])) as Record<string, Level>)} data-action="grant-full">منح صلاحية كاملة</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!full} onClick={() => setConfirmPreset(true)} data-action="revoke-full">إلغاء الصلاحية الكاملة</button>
            </div>
          )}
        </div>
        <div className="matrix">
          {sections.map((s) => {
            const lvl = matrix[s.key] ?? 'none';
            const opts = s.editable ? LEVELS : LEVELS.filter((l) => l.value !== 'edit');
            const lock = s.key === 'users' && usersLocked;
            return (
              <div key={s.key} className="matrix-row" data-section={s.key}>
                <span className="text-sm">{s.label_ar}{lock && <span className="block text-xs text-ink-muted">آخر مدير نظام فعّال — لا يُنزَّل</span>}</span>
                <Segmented value={lvl} options={opts} label={s.label_ar} disabled={!editable || lock} onChange={(v) => setMatrix({ ...matrix, [s.key]: v })} />
              </div>
            );
          })}
        </div>
        {editable && (
          <div className="flex gap-2 justify-end mt-3">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty || busy} onClick={() => setMatrix({ ...user.permissions })}>إلغاء التغييرات</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={() => onSave(`حُفظت صلاحيات ${user.full_name}`, { matrix })} data-action="perms-save">{busy && <Spinner />} حفظ الصلاحيات</button>
          </div>
        )}
      </div>
      <div className="grid gap-3 content-start">
        <Field label="الدور (قالب)" id={`role-${user.user_id}`} hint="القالب يملأ المصفوفة؛ «تطبيق القالب» يستبدل كل الصلاحيات الحالية.">
          <div className="flex gap-1">
            <select id={`role-${user.user_id}`} className="field" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={!editable}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            {editable && <button type="button" className="btn btn-ghost btn-sm shrink-0" disabled={busy || usersLocked && role !== 'admin'} onClick={() => setConfirmPreset(true)} data-action="apply-preset">تطبيق</button>}
          </div>
        </Field>
        <Field label="نطاق الفروع" id={`branch-${user.user_id}`}>
          <div className="flex gap-1">
            <select id={`branch-${user.user_id}`} className="field" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!editable}>
              <option value="">كل الفروع</option>
              {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
            </select>
            {editable && <button type="button" className="btn btn-ghost btn-sm shrink-0" disabled={!branchDirty || busy} onClick={() => onSave(`نطاق ${user.full_name}: ${branch ? BRANCH_NAMES[branch] : 'كل الفروع'}`, { setBranch: true, branch: branch || null })} data-action="branch-save">حفظ</button>}
          </div>
        </Field>
      </div>
      <Modal open={confirmPreset} onClose={() => setConfirmPreset(false)} title="تطبيق القالب" busy={busy}>
        <p className="text-sm text-ink-muted">سيُستبدل كل صلاحيات {user.full_name} بقالب «{ROLE_LABELS[role]}». يمكن التراجع من التنبيه أو من السجل.</p>
        <div className="flex gap-2 justify-end mt-5">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" onClick={() => { setConfirmPreset(false); onSave(`طُبّق قالب ${ROLE_LABELS[role]} على ${user.full_name}`, { role, applyPreset: true }); }} data-action="apply-preset-go">تطبيق القالب</button>
        </div>
      </Modal>
    </DirtyScope>
  );
}

function InviteForm({ branches, onClose, onSaved }: { branches: api.Branch[]; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('reception');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError('اكتب بريدًا إلكترونيًا صحيحًا.');
    if (name.trim().length < 2) return setError('اكتب الاسم (يظهر في سجل التدقيق).');
    setBusy(true);
    try {
      await api.inviteUser(email.trim(), name.trim(), role, branch || null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="دعوة مستخدم" busy={busy}>
      <div className="grid gap-3">
        <Field label="البريد الإلكتروني" id="u-email"><input id="u-email" className="field latin" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="الاسم الظاهر" id="u-name" hint="للاستقبال المشترك: «استقبال طريق المطار» / «استقبال طريق الشفا»"><input id="u-name" className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="الدور (قالب الصلاحيات)" id="u-role" hint="يملأ المصفوفة الأولى؛ تُعدَّل بعد ذلك لكل مستخدم.">
          <select id="u-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <Field label="نطاق الفروع" id="u-branch">
          <select id="u-branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink-muted mt-3">تصل الدعوة بالبريد برابط لتعيين كلمة المرور؛ يعمل الرابط لمرة واحدة ومن أي متصفح.</p>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="user-save">{busy && <Spinner />} إرسال الدعوة</button>
      </div>
    </Modal>
  );
}

function NameForm({ user, onClose, onSaved }: { user: StaffUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.full_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (name.trim().length < 2) return setError('اكتب الاسم (يظهر في سجل التدقيق).');
    setBusy(true);
    try {
      await api.updateUser(user.user_id, { full_name: name.trim() });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="الاسم الظاهر" busy={busy}>
      <Field label="الاسم الظاهر" id="n-name" hint="يظهر في سجل التدقيق وفي رسائل التأكيد الداخلية."><input id="n-name" className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="name-save">{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}
