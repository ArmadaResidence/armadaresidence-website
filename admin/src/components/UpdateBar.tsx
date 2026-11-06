// «يوجد تحديث جديد للوحة» (Ahmed, 5 Nov 2026): a small non-blocking bar when a newer dashboard is deployed. Nothing reloads
// until the user presses «تحديث الآن»; while anything on the page is unsaved it adds «احفظ تعديلاتك أولًا». (The draft
// safety net keeps unsaved values across a reload anyway — lib/dirty.ts.)
// Since 6 Nov 2026 the same bar shows the website's deploy status (components/SiteDeployStatus.tsx) while a deploy runs,
// after a failed one, and for 30 minutes after a success — a failed site update is never silent.
import { useNewVersion } from '../lib/version';
import { useAnyDirty } from '../lib/dirty';
import { useSiteDeploy } from '../lib/siteDeploy';
import { barShowsDeploy, deployView } from '../lib/siteDeployText';
import SiteDeployStatus from './SiteDeployStatus';

export default function UpdateBar() {
  const newer = useNewVersion();
  const dirty = useAnyDirty();
  const { data, requestedAt, now } = useSiteDeploy();
  const site = barShowsDeploy(data, requestedAt, now);
  if (!newer && !site) return null;
  return (
    <div className={`update-bar${site && deployView(data, requestedAt, now) === 'failed' ? ' update-bar-alert' : ''}`} role="status" data-update-bar>
      {newer && (
        <span className="update-bar-group">
          <span className="font-semibold">يوجد تحديث جديد للوحة</span>
          {dirty && <span className="update-bar-note" data-update-dirty>احفظ تعديلاتك أولًا</span>}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()} data-action="update-now">تحديث الآن</button>
        </span>
      )}
      {site && <SiteDeployStatus compact />}
    </div>
  );
}
