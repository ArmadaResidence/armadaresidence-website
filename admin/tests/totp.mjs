// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret — the dashboard shows the secret under the QR on
// enrolment, so the checks can enrol and verify the QA users without a phone. Shared by dashboard-check.mjs and
// deployed-pages-check.mjs.
import { createHmac } from 'node:crypto';

export function totp(secretB32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretB32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[19] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
