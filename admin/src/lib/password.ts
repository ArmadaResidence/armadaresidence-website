// Dashboard password rule (Ahmed, 26 Oct 2026): at least 8 characters, any printable ASCII except the space —
// A–Z, a–z, 0–9 and symbols such as @ _ - . ! # $ — with no required character classes. Rejected: Arabic letters,
// Arabic-Indic digits, any whitespace and any other non-ASCII character. Supabase Auth is configured the same way
// (supabase/config.toml: minimum_password_length = 8, password_requirements = none) and keeps the leaked-password
// check, which only the server can run; the note under the checklist says so. The same three lines are the live
// checklist under the password field (PasswordChecklist) and the guard before the call (passwordProblem).

export const PASSWORD_MIN = 8;
export type PasswordRule = 'length' | 'ascii' | 'spaces';

/** The checklist lines, in display order; `met` is the rule itself. */
export const PASSWORD_RULES: { key: PasswordRule; text: string; met: (p: string) => boolean }[] = [
  { key: 'length', text: '8 أحرف على الأقل', met: (p) => [...p].length >= PASSWORD_MIN },
  // every character must be printable ASCII (whitespace is the next line's business, so a tab or a no-break space
  // fails exactly one line)
  { key: 'ascii', text: 'بدون حروف أو أرقام عربية', met: (p) => !/[^\x21-\x7E\s]/.test(p) },
  { key: 'spaces', text: 'بدون مسافات', met: (p) => !/\s/.test(p) },
];
/** under the confirm field */
export const PASSWORD_MATCH = 'كلمتا المرور متطابقتان';
/** neutral note under the checklist: the leaked / common-password check runs on save, server side */
export const PASSWORD_LEAK_NOTE = 'عند الحفظ نتأكد أن كلمة المرور ليست شائعة أو مسرّبة.';
/** Auth refused the password as weak or leaked (`weak_password`) */
export const PASSWORD_WEAK = 'كلمة المرور هذه شائعة أو ظهرت في تسريبات سابقة، فيسهل تخمينها. اختر كلمة مرور أخرى.';

export function passwordChecks(p: string): Record<PasswordRule, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((r) => [r.key, r.met(p)])) as Record<PasswordRule, boolean>;
}
export function passwordOk(p: string): boolean {
  return PASSWORD_RULES.every((r) => r.met(p));
}
/** The first unmet line (the save button is disabled until none is left; this guards the call itself). null = send. */
export function passwordProblem(p: string): string | null {
  return PASSWORD_RULES.find((r) => !r.met(p))?.text ?? null;
}
/** Auth's answer to a refused password (`weak_password`): a length reason reads as the length line, every other reason
 * (pwned, or anything new) as the leaked / common-password sentence. */
export function passwordRefusal(e: { reasons?: string[] } | null | undefined): string {
  if (e?.reasons?.includes('length')) return PASSWORD_RULES[0].text;
  return PASSWORD_WEAK;
}
