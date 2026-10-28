// «الأمان» (phase 2a.2 C, 26 Oct 2026): every signed-in user — how this session passed the second step, the remembered
// devices (this browser marked) with «إلغاء الأجهزة المتذكَّرة» (keeps this session), and for admins the backup codes
// left with «إنشاء رموز جديدة» (/backup-codes?new=1 — a fresh email code first). Not undoable, like a sign-out.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { CancelButton, ErrorBox, Loading, Modal, Spinner, useToast } from '../components/ui';
import { clearDeviceToken } from '../lib/device';
import { riyadhDateTimeLong } from '../lib/format';
import { BACKUP_TEXT as B, SECURITY_TEXT as S } from '../lib/secondStep';

export default function Security() {
  const { session, me } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<api.MySecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await api.mySecurity());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  async function revoke() {
    if (!session) return;
    setBusy(true);
    try {
      await api.revokeDevices(session.user.id);
      clearDeviceToken(session.user.id);
      toast(S.revoked);
      setConfirm(false);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Loading />;
  const method = data?.second_factor ?? me?.second_factor ?? null;
  return (
    <div className="grid gap-5 max-w-3xl">
      <h1 className="text-2xl font-bold">{S.title}</h1>
      <ErrorBox error={error} />
      {data && (
        <>
          <section className="card p-5" aria-labelledby="s-method">
            <h2 id="s-method" className="font-bold text-lg mb-1">{S.method}</h2>
            <p className="text-sm" data-method={method ?? ''}>{method ? S.methods[method] ?? method : '—'}</p>
          </section>

          <section className="card p-5" aria-labelledby="s-devices">
            <h2 id="s-devices" className="font-bold text-lg mb-1">{S.devices}</h2>
            <p className="text-sm text-ink-muted mb-3">{S.devicesIntro}</p>
            {data.devices.length === 0 ? (
              <p className="text-sm text-ink-muted" data-no-devices>{S.noDevices}</p>
            ) : (
              <ul className="grid gap-2 mb-3" data-devices>
                {data.devices.map((d) => (
                  <li key={d.id} className="rounded border border-line p-3 text-sm" data-device={d.id}>
                    <div className="font-semibold">
                      <span className="latin" dir="ltr">{d.label}</span>
                      {d.id === data.current_device && <span className="chip chip-flag ms-2">{S.thisDevice}</span>}
                    </div>
                    <div className="text-ink-muted num-ar">
                      {S.since} {riyadhDateTimeLong(d.created_at)} · {S.lastUsed} {d.last_used_at ? riyadhDateTimeLong(d.last_used_at) : '—'} · {S.expires} {riyadhDateTimeLong(d.expires_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.devices.length > 0 && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm(true)} data-action="revoke-my-devices">{S.revoke}</button>
            )}
          </section>

          {data.is_admin && (
            <section className="card p-5" aria-labelledby="s-backup">
              <h2 id="s-backup" className="font-bold text-lg mb-1">{S.backup}</h2>
              <p className="text-sm mb-3 num-ar" data-backup-left={data.backup_codes_left ?? 0}>
                {(data.backup_codes_left ?? 0) > 0 ? S.backupLeft(data.backup_codes_left ?? 0) : S.backupNone}
              </p>
              <p className="text-xs text-ink-muted mb-3">{B.regenerateWarn}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav('/backup-codes?new=1')} data-action="regenerate-backup">
                {(data.backup_codes_left ?? 0) > 0 ? B.regenerate : B.generate}
              </button>
            </section>
          )}
        </>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title={S.revoke} busy={busy}>
        <p className="text-sm mb-4">{S.revokeSelfBody}</p>
        <div className="flex gap-2 justify-end">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-danger" onClick={revoke} disabled={busy} data-action="revoke-my-devices-go">{busy && <Spinner />} {S.revokeGo}</button>
        </div>
      </Modal>
    </div>
  );
}
