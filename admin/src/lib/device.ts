// «تذكّر هذا الجهاز لمدة 30 يومًا» (phase 2a.2 C, 26 Oct 2026): the browser keeps one random token per user; the
// database keeps only its hash (public.verify_login_code / use_remembered_device). A shared reception PC keeps one
// token per login, so two logins on the same browser never use each other's device.

const key = (userId: string) => `armada-device:${userId}`;

export function getDeviceToken(userId: string): string | null {
  try {
    const t = localStorage.getItem(key(userId));
    return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}
export function setDeviceToken(userId: string, token: string): void {
  try {
    localStorage.setItem(key(userId), token);
  } catch {
    /* storage blocked: the code is asked again next time */
  }
}
export function clearDeviceToken(userId: string): void {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}

/** «Chrome · Windows» — the label of a remembered device (the login-code email names the device the same way). */
export function deviceLabel(ua: string = navigator.userAgent): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'متصفح';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}

/** a***@armadaresidence.com — the code screen says where the code went without spelling the address out */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? '');
  const at = e.indexOf('@');
  if (at < 1) return e;
  return `${e[0]}***${e.slice(at)}`;
}
