// «يوجد تحديث جديد للوحة» (Ahmed, 5 Nov 2026): a small non-blocking bar when a newer dashboard is deployed. Nothing reloads
// until the user presses «تحديث الآن»; while anything on the page is unsaved it adds «احفظ تعديلاتك أولًا». (The draft
// safety net keeps unsaved values across a reload anyway — lib/dirty.ts.)
import { useNewVersion } from '../lib/version';
import { useAnyDirty } from '../lib/dirty';

export default function UpdateBar() {
  const newer = useNewVersion();
  const dirty = useAnyDirty();
  if (!newer) return null;
  return (
    <div className="update-bar" role="status" data-update-bar>
      <span className="font-semibold">يوجد تحديث جديد للوحة</span>
      {dirty && <span className="update-bar-note" data-update-dirty>احفظ تعديلاتك أولًا</span>}
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()} data-action="update-now">تحديث الآن</button>
    </div>
  );
}
