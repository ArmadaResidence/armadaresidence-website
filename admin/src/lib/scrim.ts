// «الصور»: how strong the site's navy layer must be behind the text over a photo (Ahmed, 7 Nov 2026). The same rule as
// the site build (scripts/photos-engine.mjs → heroScrim / cardScrim): the lightest Armada Midnight layer that keeps
// every small text at 4.5:1 (+ 0.2 margin) over the brightest pixels where the text sits. The aim is 0.6 or less; above
// it the page shows a warning on the photo (the site still uses what the photo needs — AA is never traded away). The
// build's own measure (on the full-size file) decides on the site; this one runs on the dashboard's preview.

/** the largest box of `ratio` inside w × h around the focal point (the build's cropBox; kept here so this file stands
 *  alone — the unit tests import it) */
function cropBox(w: number, h: number, ratio: number, fx: number, fy: number) {
  let cw = w;
  let ch = Math.round(w / ratio);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * ratio);
  }
  return { left: Math.min(Math.max(Math.round(fx * w - cw / 2), 0), w - cw), top: Math.min(Math.max(Math.round(fy * h - ch / 2), 0), h - ch), width: cw, height: ch };
}

const MID = [0x14, 0x2a, 0x3b];
const POR = [0xf3, 0xef, 0xe7];
const BRONZE_BRIGHT = [0xc9, 0xa2, 0x7a];
/** the aim behind the text (Ahmed, 7 Nov 2026) */
export const SCRIM_AIM = 0.6;
const MIN = 0.15;
const MAX = 0.92;
const NEED = 4.5 + 0.2;
const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** the texts that decide: a Porcelain share over the background, or Bronze Bright (the hero: subtitle 85 %, button and
 *  headline 100 %, eyebrow; a «فرعانا» card: description 75 %, phone 85 %, tagline 90 %, type) */
export const HERO_TEXTS: (number | 'bronze')[] = [0.85, 1, 'bronze'];
export const CARD_TEXTS: (number | 'bronze')[] = [0.75, 0.85, 0.9, 'bronze'];

/** the lightest alpha in [0.15, 0.92] (two decimals) that keeps every text at 4.5:1 + 0.2 over every pixel given */
export function alphaFor(pixels: [number, number, number][], texts: (number | 'bronze')[] = HERO_TEXTS): number {
  const LB = lum(BRONZE_BRIGHT[0], BRONZE_BRIGHT[1], BRONZE_BRIGHT[2]);
  const ok = (a: number) => pixels.every(([r, g, b]) => {
    const bg = [a * MID[0] + (1 - a) * r, a * MID[1] + (1 - a) * g, a * MID[2] + (1 - a) * b];
    const L = lum(bg[0], bg[1], bg[2]);
    return texts.every((t) => (t === 'bronze' ? contrast(LB, L) >= NEED : contrast(lum(t * POR[0] + (1 - t) * bg[0], t * POR[1] + (1 - t) * bg[1], t * POR[2] + (1 - t) * bg[2]), L) >= NEED));
  });
  for (let i = Math.round(MIN * 100); i <= Math.round(MAX * 100); i++) if (ok(i / 100)) return i / 100;
  return MAX;
}

/** the brightest pixels (up to `count`) of a region of RGBA data — the ones that decide */
export function brightest(data: Uint8ClampedArray, w: number, x0: number, x1: number, y0: number, y1: number, count = 1500): [number, number, number][] {
  const list: [number, number, number, number][] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      list.push([data[i], data[i + 1], data[i + 2], lum(data[i], data[i + 1], data[i + 2])]);
    }
  }
  list.sort((a, b) => b[3] - a[3]);
  return list.slice(0, count).map(([r, g, b]) => [r, g, b]);
}

/** where the text sits on a photo, as the build measures it: `hero` = a 16:9 crop around the focal point, the start-side
 *  62 % in either language between the rows the 560 px hero shows behind the text at 1280 px; `card` = the lower 60 % of
 *  a branch cover (desktop card); `card-phone` = the lower 55 % of a phone photo (phone card) */
export type ScrimPlace = 'hero' | 'card' | 'card-phone';

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('image'));
  img.src = url;
});

/** the alpha a photo needs behind the text at `place` (its preview at `url`, its focal point); null when the browser
 *  cannot read the preview */
export async function scrimNeed(url: string, place: ScrimPlace, focal: { x: number; y: number }): Promise<number | null> {
  try {
    const img = await loadImage(url);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return null;
    let box = { left: 0, top: 0, width: W, height: H };
    if (place === 'hero') box = cropBox(W, H, 16 / 9, focal.x, focal.y);
    const cw = Math.min(720, box.width);
    const ch = Math.round((cw * box.height) / box.width);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, box.left, box.top, box.width, box.height, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);
    if (place === 'hero') {
      const share = Math.round(cw * 0.62);
      // the focal point's place inside the crop (the vertical object-position the site uses)
      const posY = box.height === H ? 0.5 : box.top / (H - box.height);
      const v = 0.78;
      const y0 = Math.max(0, Math.round(((1 - v) * posY + 0.24 * v - 0.04) * ch));
      const y1 = Math.min(ch, Math.round(((1 - v) * posY + 0.76 * v + 0.04) * ch));
      return Math.max(alphaFor(brightest(data, cw, 0, share, y0, y1)), alphaFor(brightest(data, cw, cw - share, cw, y0, y1)));
    }
    const from = Math.round(ch * (place === 'card' ? 0.4 : 0.45));
    return alphaFor(brightest(data, cw, 0, cw, from, ch), CARD_TEXTS);
  } catch {
    return null;
  }
}

/** the warning shown on the photo when it needs more than the aim (Arabic, Western digits) */
export function brightWarning(alpha: number, place: ScrimPlace): string {
  const where = place === 'hero' ? 'خلف نص الواجهة' : place === 'card' ? 'خلف نص بطاقة «فرعانا»' : 'خلف نص البطاقة على الجوال';
  return `الصورة فاتحة ${where}: يحتاج النص طبقة كحلية بقوة ${Math.round(alpha * 100)}% تقريبًا ليبقى واضحًا (المستهدف ${Math.round(SCRIM_AIM * 100)}% أو أقل). جرّب صورة أغمق في جهة النص، أو غيّر نقطة التركيز ليقع جزء أغمق خلف النص.`;
}
