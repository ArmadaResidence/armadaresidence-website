// Which rebuild requests go through the database debounce (public.site_rebuild_claim). 6 Nov 2026: a room's
// availability («الغرف») and a Settings fee are baked into the pages at build time, and a build reads them about a minute
// after it starts — a second change inside the 2-minute window, debounced, could miss the build already running and
// never reach the site. Those reasons now always dispatch (like a publish job): in the Pages concurrency group a newer
// request waits for the running deploy (never cancelled) and replaces any request still waiting, so the last one runs
// after it and reads every change. Pure module: scripts/deploy-alert-check.mjs imports it.
export const ALWAYS_DISPATCH = new Set(['rooms', 'settings']);

/** true → claim the debounce window first; false → dispatch at once */
export function usesDebounce(reason: string, hasJob: boolean): boolean {
  return !hasJob && !ALWAYS_DISPATCH.has(reason);
}
