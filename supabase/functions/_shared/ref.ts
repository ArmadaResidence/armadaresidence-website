// The request reference of every public form (booking requests, partner enquiries, job applications — 28 Oct 2026):
// «AR-YYYYMMDD-XXXX», the UTC date and four characters of an alphabet without look-alikes (no 0/O, 1/I). Every email
// subject carries it: the mailboxes' server-side filter (From no-reply@ AND Subject contains «AR-») depends on it.
export function makeRef(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const tail = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `AR-${ymd}-${tail}`;
}
