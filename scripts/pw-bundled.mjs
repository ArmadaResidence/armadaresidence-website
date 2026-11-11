// Browser checks inside the official Playwright image (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Browser checks in
// the Playwright image»). On 11 Nov 2026 two deploys stopped because the runners could not reach the Ubuntu mirrors:
// `playwright install-deps` (apt) hung and every browser shard was cancelled. The jobs now run in
// mcr.microsoft.com/playwright:v<our Playwright version>-noble, which already holds Chromium, WebKit and their system
// libraries — no apt, no download. That image has no Google Chrome, and the checks ask for `channel: 'chrome'`; with
// ARMADA_PW_BUNDLED=1 (the jobs' env, preloaded through NODE_OPTIONS=--import) this module turns that request into the
// image's own full Chromium (`channel: 'chromium'`, the new headless mode — the same engine and rendering path as
// Chrome; Chrome-only codecs such as H.264 are the one difference, and a check needing them would fail visibly).
// A machine that has Google Chrome keeps it. Nothing else changes.
import { existsSync } from 'node:fs';
import * as pw from 'playwright';

const CHROME = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
if (process.env.ARMADA_PW_BUNDLED === '1' && !CHROME.some((p) => existsSync(p))) {
  const fix = (o) => (o && o.channel === 'chrome' ? { ...o, channel: 'chromium' } : o);
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = (o, ...a) => launch(fix(o), ...a);
  const persistent = pw.chromium.launchPersistentContext.bind(pw.chromium);
  pw.chromium.launchPersistentContext = (dir, o, ...a) => persistent(dir, fix(o), ...a);
}
