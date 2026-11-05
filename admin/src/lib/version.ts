// A newer dashboard deployed while this tab is open (Ahmed, 5 Nov 2026): the dashboard NEVER reloads by itself. It compares
// its own build id (__ADMIN_BUILD__, set by vite.config.ts) with the deployed version.json when the tab comes back to the
// front, when the window gets focus and every 5 minutes; a different id only raises `newVersion` — the update bar
// (components/UpdateBar.tsx) offers «تحديث الآن», and the page reloads only when the user presses it.
import { useEffect, useState } from 'react';

declare const __ADMIN_BUILD__: string;
export const BUILD_ID: string = typeof __ADMIN_BUILD__ === 'string' ? __ADMIN_BUILD__ : 'dev';
const EVERY_MS = 5 * 60 * 1000;

/** the deployed build id, or null when it cannot be read (offline, the dev server) */
export async function deployedBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null;
  }
}

/** true once a deploy newer than this tab's bundle is seen (stays true until the user reloads) */
export function useNewVersion(): boolean {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (newer) return;
    let live = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const d = await deployedBuild();
      if (live && d && d !== BUILD_ID) setNewer(true);
    };
    const onVis = () => void check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const t = window.setInterval(check, EVERY_MS);
    void check();
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(t);
    };
  }, [newer]);
  return newer;
}
