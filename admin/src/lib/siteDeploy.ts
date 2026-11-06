// The website's deploy status for the dashboard (6 Nov 2026): one shared poll of public.site_deploy_status() for every
// component that shows it (the update bar, «الغرف»). Every 15 s while a deploy runs or a rebuild this tab asked for has
// not started yet; otherwise when the tab comes back to the front and every 5 minutes. api.siteRebuild() announces each
// dispatched rebuild with the window event `armada:site-rebuild`, so «جارٍ» shows at once on every page.
import { useEffect, useState } from 'react';
import * as api from './api';
import { PENDING_MS, deployView, type SiteDeploy } from './siteDeployText';

export const REBUILD_EVENT = 'armada:site-rebuild';
const FAST_MS = 15 * 1000;
const SLOW_MS = 5 * 60 * 1000;

interface State { data: SiteDeploy | null; requestedAt: number | null; now: number }
let state: State = { data: null, requestedAt: null, now: Date.now() };
const listeners = new Set<(s: State) => void>();
let timer: number | null = null;
let inflight: Promise<void> | null = null;

function emit(patch: Partial<State>) {
  state = { ...state, ...patch, now: Date.now() };
  for (const l of listeners) l(state);
  schedule();
}

async function refresh(): Promise<void> {
  inflight ??= api.siteDeployStatus()
    .then((data) => emit({ data }))
    .catch(() => emit({}))
    .finally(() => { inflight = null; });
  return inflight;
}

function busy(): boolean {
  if (state.requestedAt !== null && Date.now() - state.requestedAt >= PENDING_MS) state = { ...state, requestedAt: null };
  return deployView(state.data, state.requestedAt, Date.now()) === 'running';
}

function schedule() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (!listeners.size) return;
  timer = window.setTimeout(() => {
    if (document.visibilityState === 'visible') void refresh();
    else schedule();
  }, busy() ? FAST_MS : SLOW_MS);
}

function onFront() {
  if (document.visibilityState === 'visible') void refresh();
}
function onRebuild() {
  emit({ requestedAt: Date.now() });
  void refresh();
}

/** the shared status; the first component to use it starts the poll, the last one to leave stops it */
export function useSiteDeploy(): State {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    listeners.add(setS);
    if (listeners.size === 1) {
      document.addEventListener('visibilitychange', onFront);
      window.addEventListener('focus', onFront);
      window.addEventListener(REBUILD_EVENT, onRebuild);
      void refresh();
    } else setS(state);
    return () => {
      listeners.delete(setS);
      if (!listeners.size) {
        document.removeEventListener('visibilitychange', onFront);
        window.removeEventListener('focus', onFront);
        window.removeEventListener(REBUILD_EVENT, onRebuild);
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return s;
}
