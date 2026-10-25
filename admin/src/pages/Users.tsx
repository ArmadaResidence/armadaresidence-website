// Users (decision 8, admin only): list, invite, role / branch, deactivate, resend the invite or a reset link.
// Everything goes through the admin-users Edge Function; the dashboard never touches auth.users itself.
import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { Role, StaffUser } from '../lib/api';
import { BRANCH_NAMES, ROLE_LABELS, riyadhDateTime } from '../lib/format';
import { ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';

export default function Users() {
  const toast = useToast();
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<StaffUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [u, b] = await Promise.all([api.listUsers(), api.branches()]);
      setUsers(u.users);
      setBranches(b);
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

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold me-auto">المستخدمون</h1>
        <button type="button" className="btn btn-primary" onClick={() => setInvite(true)} data-action="invite">دعوة مستخدم</button>
      </div>
      <p className="text-sm text-ink-muted mb-4">الاستقبال: حساب واحد لكل فرع يرى فرعه فقط. الإدارة والمبيعات: الفرعان. التحقق بخطوتين إلزامي لغير الاستقبال.</p>
      <ErrorBox error={error} />
      {users === null ? (
        <Loading />
      ) : (
        <ul className="grid gap-2">
          {users.map((u) => (
            <li key={u.user_id} className="card p-3 sm:p-4 grid sm:grid-cols-[1fr_auto] gap-3 items-center" data-user={u.email}>
              <div className="min-w-0">
                <div className="font-bold truncate">{u.full_name ?? '—'} <span className="latin text-xs text-ink-muted" dir="ltr">{u.email}</span></div>
                <div className="text-sm text-ink-muted flex flex-wrap gap-x-2">
                  <span>{u.role ? ROLE_LABELS[u.role] : 'بلا دور'}</span>
                  {u.branch && <span>· {BRANCH_NAMES[u.branch]}</span>}
                  <span>· {u.active ? 'مفعّل' : 'موقوف'}</span>
                  <span>· {u.confirmed ? 'كلمة المرور معيّنة' : 'الدعوة لم تُقبل بعد'}</span>
                  <span>· التحقق بخطوتين: {u.mfa_enrolled ? 'مفعّل' : 'غير مفعّل'}</span>
                  {u.last_sign_in_at && <span className="num">· آخر دخول {riyadhDateTime(u.last_sign_in_at)}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(u)}>تعديل</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy === u.user_id} onClick={() => act('أُرسل الرابط', u.user_id, () => api.resendLink(u.user_id))}>{u.confirmed ? 'رابط كلمة مرور' : 'إعادة الدعوة'}</button>
                <button type="button" className={`btn btn-sm ${u.active ? 'btn-danger' : 'btn-primary'}`} disabled={busy === u.user_id || !u.role} onClick={() => act(u.active ? 'أُوقف الحساب' : 'فُعّل الحساب', u.user_id, () => api.updateUser(u.user_id, { active: !u.active }))}>{u.active ? 'إيقاف' : 'تفعيل'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {invite && <UserForm branches={branches} onClose={() => setInvite(false)} onSaved={() => { setInvite(false); toast('أُرسلت الدعوة'); load(); }} />}
      {edit && <UserForm branches={branches} user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('حُفظ'); load(); }} />}
    </div>
  );
}

function UserForm({ branches, user, onClose, onSaved }: { branches: api.Branch[]; user?: StaffUser; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.full_name ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'reception');
  const [branch, setBranch] = useState(user?.branch ?? branches[0]?.slug ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    if (name.trim().length < 2) return setError('اكتب الاسم (يظهر في سجل التدقيق).');
    setBusy(true);
    try {
      const b = role === 'reception' ? branch : null;
      if (user) await api.updateUser(user.user_id, { full_name: name.trim(), role, branch: b });
      else await api.inviteUser(email.trim(), name.trim(), role, b);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={user ? 'تعديل مستخدم' : 'دعوة مستخدم'}>
      <div className="grid gap-3">
        <Field label="البريد الإلكتروني" id="u-email"><input id="u-email" className="field latin" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!user} /></Field>
        <Field label="الاسم الظاهر" id="u-name" hint="للاستقبال المشترك: «استقبال طريق المطار» / «استقبال طريق الشفا»"><input id="u-name" className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="الدور" id="u-role">
          <select id="u-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(['admin', 'management', 'sales', 'reception'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        {role === 'reception' && (
          <Field label="الفرع" id="u-branch">
            <select id="u-branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
            </select>
          </Field>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="user-save">{busy && <Spinner />} {user ? 'حفظ' : 'إرسال الدعوة'}</button>
      </div>
    </Modal>
  );
}
