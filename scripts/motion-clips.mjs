// Short clips (WebM, ~5 s) and stills of the motion work for review — Arabic pages at 1440 and 375.
//   node scripts/motion-clips.mjs <scenario> [more scenarios…]      (needs a preview on 127.0.0.1:4321)
//   node scripts/motion-clips.mjs --list
// Output: screenshots/motion/<scenario>-<width>.webm (+ .png still at the end). Uses the local Chrome through
// Playwright (recordVideo); ffmpeg (if on PATH) trims the clip to its first 5 s and re-encodes it small.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');
const OUT = 'screenshots/motion';
const SIZES = [
  { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each scenario drives one page for ~5 s. `page` is a Playwright page; `size` the viewport. */
const SCENARIOS = {
  // item 1: room card → room page (shared media), then back; the header stays put
  'view-transitions': async (page, size) => {
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const card = page.locator('a[href="/airport-road/one-bedroom-suite/"]').first();
    await card.scrollIntoViewIfNeeded();
    await wait(700);
    await card.click();
    await wait(1800);
    await page.goBack();
    await wait(1400);
    await page.locator('header a[hreflang="en"]').click();
    await wait(1200);
  },
  // item 3: the hero sequence on a fresh load (words → bronze rule → subtitle → buttons) and the pattern drifting
  hero: async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await wait(2600);
    await page.reload({ waitUntil: 'commit' });
    await wait(2400);
  },
  // item 4: the split-screen branch chooser — hover the first pane, then the second (desktop); on mobile the two
  // near-full-height cards scroll past
  split: async (page, size) => {
    await page.goto(`${BASE}/#branches`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const split = page.locator('[data-split]');
    await split.scrollIntoViewIfNeeded();
    await wait(900);
    if (size.width >= 768) {
      const panes = page.locator('.split-pane');
      const a = await panes.nth(0).boundingBox();
      const b = await panes.nth(1).boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 12 });
      await wait(1300);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await wait(1300);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height + 60, { steps: 8 });
      await wait(900);
    } else {
      await page.evaluate(async () => {
        const el = document.querySelector('[data-split]');
        const start = scrollY;
        const end = start + el.getBoundingClientRect().height;
        const t0 = performance.now();
        await new Promise((done) => {
          const tick = () => {
            const p = Math.min(1, (performance.now() - t0) / 4000);
            scrollTo(0, start + (end - start) * p);
            p < 1 ? requestAnimationFrame(tick) : done();
          };
          requestAnimationFrame(tick);
        });
      });
      await wait(600);
    }
  },
  // item 5: nav ink sliding between items, the theme glyph morphing, floating labels on the booking form, the
  // WhatsApp pulse (5 s after load) — desktop; on mobile the form labels + the pulse
  micro: async (page, size) => {
    await page.goto(`${BASE}/booking/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    if (size.width >= 768) {
      const links = page.locator('[data-nav] .nav-link');
      for (const i of [1, 3, 5]) {
        const b = await links.nth(i).boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
        await wait(550);
      }
      await page.mouse.move(700, 300, { steps: 6 });
      await wait(400);
      await page.locator('[data-theme-toggle]').click();
      await wait(700);
      await page.locator('[data-theme-toggle]').click();
      await wait(500);
    }
    await page.locator('#name').click();
    await page.keyboard.type('أحمد', { delay: 90 });
    await wait(300);
    await page.locator('#phone').click();
    await wait(400);
    await page.locator('#email').click();
    await wait(600);
    const btn = page.locator('button[type=submit]');
    const bb = await btn.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
    await wait(500);
    await page.mouse.move(bb.x - 40, bb.y + bb.height + 40, { steps: 6 });
    await wait(400);
  },
  // item 6: the figures counting up when the strip comes into view (home "why Armada", then the branch strip)
  counters: async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const el = document.querySelector('[data-counters]');
      const y = el.getBoundingClientRect().top + scrollY - innerHeight + 60;
      scrollTo(0, Math.max(0, y));
    });
    await wait(500);
    await page.evaluate(() => scrollBy({ top: 260, behavior: 'smooth' }));
    await wait(2200);
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'load' });
    await page.evaluate(() => {
      const el = document.querySelector('[data-counters]');
      scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.55);
    });
    await wait(1900);
  },
  // item 7: room cards — swipe through the strip on a phone; the desktop grid is unchanged (shown briefly)
  rooms: async (page, size) => {
    await page.goto(`${BASE}/shafa-road/#rooms`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.querySelector('[data-carousel]').scrollIntoView({ block: 'center' }));
    await wait(900);
    if (size.width < 768) {
      // move through the strip the way the native scroller does it: wheel on a phone is not real, so tap the dots
      // (snap scroll follows) and finish with a horizontal scroll of the track itself
      const dots = page.locator('[data-carousel-dots] button');
      for (const i of [1, 2, 3]) {
        await dots.nth(i).click();
        await wait(900);
      }
      await page.evaluate(async () => {
        const track = document.querySelector('[data-carousel-track]');
        const rtl = getComputedStyle(track).direction === 'rtl';
        const step = track.clientWidth * 0.85;
        for (let k = 0; k < 2; k++) {
          track.scrollBy({ left: rtl ? -step : step, behavior: 'smooth' });
          await new Promise((r) => setTimeout(r, 900));
        }
      });
      await wait(600);
    } else {
      await wait(2000);
    }
  },
  // item 8: room page — the booking card sticks on desktop; on a phone the bottom bar slides up after the card
  roombar: async (page, size) => {
    await page.goto(`${BASE}/airport-road/one-bedroom-suite/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await wait(400);
    await page.evaluate(async () => {
      const end = Math.min(document.documentElement.scrollHeight - innerHeight, innerHeight * 2.6);
      const t0 = performance.now();
      await new Promise((done) => {
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / 4200);
          scrollTo(0, end * p);
          p < 1 ? requestAnimationFrame(tick) : done();
        };
        requestAnimationFrame(tick);
      });
    });
    await wait(800);
  },
  // item 9: the bronze glow trailing the pointer over the hero and the footer (desktop only — the phone clip just shows
  // the same surfaces without it)
  glow: async (page, size) => {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await wait(1200);
    if (size.width >= 768) {
      const hero = await page.locator('.hero').boundingBox();
      await page.mouse.move(hero.x + 200, hero.y + 200);
      await page.mouse.move(hero.x + hero.width - 300, hero.y + 160, { steps: 40 });
      await page.mouse.move(hero.x + hero.width / 2, hero.y + hero.height - 120, { steps: 40 });
      await page.mouse.move(hero.x + 300, hero.y + 240, { steps: 40 });
      await wait(400);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await wait(600);
      const f = await page.locator('footer').boundingBox();
      await page.mouse.move(f.x + 200, f.y + 120);
      await page.mouse.move(f.x + f.width - 300, f.y + 200, { steps: 45 });
      await wait(500);
    } else {
      await wait(1500);
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
      await wait(1800);
    }
  },
  // item 10: the branch scroll story — the picture stays, the scenes change it as they pass the middle
  story: async (page) => {
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const el = document.querySelector('[data-story]');
      scrollTo(0, el.getBoundingClientRect().top + scrollY - 90);
    });
    await wait(700);
    await page.evaluate(async () => {
      const el = document.querySelector('[data-story]');
      const start = scrollY;
      const end = start + el.getBoundingClientRect().height - innerHeight * 0.7;
      const t0 = performance.now();
      await new Promise((done) => {
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / 4600);
          scrollTo(0, start + (end - start) * p);
          p < 1 ? requestAnimationFrame(tick) : done();
        };
        requestAnimationFrame(tick);
      });
    });
    await wait(500);
  },
  // item 11: the booking drawer — opened from a room card CTA (prefilled), closed with Esc; phone = bottom sheet
  drawer: async (page, size) => {
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await wait(500);
    if (size.width >= 768) await page.locator('header a[href*="/booking/"]').first().click();
    else await page.locator('.room-bar a, a[href*="/booking/?branch=airport-road"]').first().click();
    await wait(1600);
    await page.locator('#drawer-name').click();
    await page.keyboard.type('أحمد', { delay: 80 });
    await wait(600);
    await page.keyboard.press('Escape');
    await wait(900);
    // a room page CTA prefills branch + room type
    await page.goto(`${BASE}/airport-road/one-bedroom-suite/`, { waitUntil: 'load' });
    await wait(400);
    const cta = page.locator('[data-book-card] a[href*="/booking/"]').first();
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
    await wait(1500);
  },
  // item 12: the bronze divider drawn as it comes into view (home, under the branch chooser)
  divider: async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const el = document.querySelector('.divider');
      scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight - 40);
    });
    await wait(600);
    await page.evaluate(() => scrollBy({ top: innerHeight * 0.55, behavior: 'smooth' }));
    await wait(2400);
    await page.evaluate(() => {
      const el = document.querySelectorAll('.divider')[1];
      scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight - 40);
    });
    await wait(400);
    await page.evaluate(() => scrollBy({ top: innerHeight * 0.55, behavior: 'smooth' }));
    await wait(1800);
  },
  // item 13: progressive photos — the dining gallery on a throttled connection: brand tint + blurred preview, then
  // the photo sharpens as it arrives
  photos: async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: (600 * 1024) / 8, uploadThroughput: (300 * 1024) / 8 });
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.querySelector('[data-gallery]').scrollIntoView({ block: 'center' }));
    await wait(2800);
    await page.locator('[data-gallery-next]').click();
    await wait(2400);
  },
  // item 2: a slow scroll down the home page — headings, cards and sections rise in once, siblings 60 ms apart
  reveal: async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await wait(400);
    await page.evaluate(async () => {
      const end = Math.min(document.documentElement.scrollHeight - innerHeight, innerHeight * 3.2);
      const t0 = performance.now();
      const dur = 4500;
      await new Promise((done) => {
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / dur);
          scrollTo(0, end * p);
          p < 1 ? requestAnimationFrame(tick) : done();
        };
        requestAnimationFrame(tick);
      });
    });
    await wait(500);
  },
};

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (process.argv.includes('--list') || names.length === 0) {
  console.log('scenarios:', Object.keys(SCENARIOS).join(', '));
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
let browser;
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {}
}
if (!browser) throw new Error('no local Chrome/Edge');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

for (const name of names) {
  const run = SCENARIOS[name];
  if (!run) {
    console.error(`unknown scenario ${name}`);
    continue;
  }
  for (const size of SIZES) {
    const tmp = `${OUT}/.tmp-${name}-${size.width}`;
    rmSync(tmp, { recursive: true, force: true });
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.deviceScaleFactor,
      isMobile: size.isMobile,
      hasTouch: size.isMobile,
      locale: 'ar-SA',
      recordVideo: { dir: tmp, size: { width: size.width, height: size.height } },
    });
    const page = await ctx.newPage();
    await run(page, size);
    await page.screenshot({ path: `${OUT}/${name}-${size.width}.png` });
    const video = page.video();
    await ctx.close();
    const raw = await video.path();
    const out = `${OUT}/${name}-${size.width}.webm`;
    if (hasFfmpeg) {
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-t', '6', '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-an', out], { stdio: 'inherit' });
      if (r.status !== 0) renameSync(raw, out);
    } else renameSync(raw, out);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`${out}  (${size.width}×${size.height})`);
  }
}
await browser.close();
