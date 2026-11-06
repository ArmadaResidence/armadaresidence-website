// «حالة تحديث الموقع» (6 Nov 2026): the website's last deploy — نجح / جارٍ / فشل + the time — in «الغرف» and in the
// update bar (compact: inside the bar's own status region). Texts: lib/siteDeployText.ts; data: lib/siteDeploy.ts.
import { useSiteDeploy } from '../lib/siteDeploy';
import { DEPLOY_TEXT, deployLine } from '../lib/siteDeployText';

export default function SiteDeployStatus({ compact = false }: { compact?: boolean }) {
  const { data, requestedAt, now } = useSiteDeploy();
  const line = deployLine(data, requestedAt, now);
  const tone = line.view === 'failed' ? 'text-error' : line.view === 'succeeded' ? 'text-ok' : 'text-ink-muted';
  return (
    <span className={`site-deploy ${compact ? 'site-deploy-compact' : ''}`} data-site-deploy={line.view} role={compact ? undefined : 'status'}>
      <span className={`font-semibold ${tone}`}>{line.text}</span>
      {line.detail && <span className="site-deploy-detail">{line.detail}</span>}
      {line.link && (
        <a href={line.link} target="_blank" rel="noopener noreferrer" className="site-deploy-link" data-action="deploy-run">{DEPLOY_TEXT.runLink}</a>
      )}
    </span>
  );
}
