// Staff-facing texts of the second step (phase 2a.2 C, 26 Oct 2026; approved by Ahmed the same day, docs/phase-2a2-copy.md): the code
// screen, the backup codes and «الأمان». Counts through the dashboard's one agreement helper (format.ts). The unit
// tests (scripts/admin-format-check.mjs) import this file, hence the explicit `.ts` extension.
import { attemptsWord, codesWord, devicesWord, minutesWord, secondsWord } from './format.ts';

/** /code — the email code */
export const CODE_TEXT = {
  title: 'التحقق بخطوتين',
  sent: (email: string) => `أرسلنا رمزًا من 6 أرقام إلى ${email}. أدخله هنا لإكمال الدخول.`,
  checkingDevice: 'جارٍ التحقق من هذا الجهاز…',
  sending: 'جارٍ إرسال الرمز…',
  label: 'الرمز',
  remember: 'تذكّر هذا الجهاز لمدة 30 يومًا',
  rememberHint: 'لا تختره على جهاز عام.',
  verify: 'تحقق',
  resend: 'إعادة إرسال الرمز',
  resendIn: (s: number) => `إعادة الإرسال بعد ${secondsWord(s)}`,
  wrong: (left: number) => `الرمز غير صحيح. بقيت ${attemptsWord(left)}.`,
  locked: 'أُدخل رمز خاطئ 5 مرات، فأُلغي هذا الرمز. اطلب رمزًا جديدًا.',
  expired: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.',
  none: 'لا يوجد رمز صالح لهذه الجلسة. اطلب رمزًا جديدًا.',
  tooSoon: 'أرسلنا رمزًا قبل قليل وما زال صالحًا. تحقق من بريدك.',
  rateLimit: (minutes: number) => `طلبات رموز كثيرة. حاول بعد ${minutesWord(minutes)}.`,
  sendFailed: 'تعذّر إرسال الرمز بالبريد. أعد المحاولة، وإن تكرر فتواصل مع مدير النظام.',
  backupLink: 'لم يصلك البريد؟ استخدم رمز طوارئ',
  backupLabel: 'رمز الطوارئ',
  backupHint: 'رمز من 10 أحرف وأرقام، مثل K7M2Q-9TXW4. يعمل كل رمز مرة واحدة.',
  backupVerify: 'تحقق برمز الطوارئ',
  backupBack: 'العودة إلى رمز البريد',
  backupWrong: (left: number) => `رمز الطوارئ غير صحيح. بقيت ${attemptsWord(left)}.`,
  backupLocked: 'محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم أعد المحاولة.',
  backupNone: 'لا توجد رموز طوارئ صالحة لهذا الحساب.',
  backupUsed: (left: number) => `تم الدخول برمز طوارئ. ${left ? `بقي لديك ${codesWord(left)}.` : 'لم يبقَ لديك رموز؛ أنشئ رموزًا جديدة بعد أن يعمل البريد.'}`,
  signOut: 'تسجيل الخروج',
};

/** /backup-codes — admins only */
export const BACKUP_TEXT = {
  title: 'رموز الطوارئ',
  intro: 'إن لم يصلك رمز البريد يومًا، تدخل بأحد هذه الرموز بدلًا منه. لكل رمز استخدام واحد. تظهر الرموز مرة واحدة فقط، فاحفظها الآن في مكان آمن بعيدًا عن البريد.',
  forced: 'حسابك مدير نظام: أنشئ رموز الطوارئ قبل المتابعة حتى لا يُغلق الدخول عليك إن تعطّل البريد.',
  generate: 'إنشاء رموز الطوارئ',
  regenerate: 'إنشاء رموز جديدة',
  regenerateWarn: 'تتوقف الرموز الحالية غير المستخدمة عن العمل فور إنشاء الجديدة.',
  stepUp: 'للأمان نرسل رمزًا جديدًا إلى بريدك قبل إنشاء الرموز.',
  yourCodes: 'رموزك العشرة',
  download: 'تنزيل',
  print: 'طباعة',
  copy: 'نسخ',
  copied: 'نُسخت الرموز',
  saved: 'حفظتُ الرموز في مكان آمن',
  continue: 'متابعة',
  later: 'لاحقًا',
  back: 'العودة إلى الأمان',
  laterNote: 'سنذكّرك عند الدخول التالي.',
  fileTitle: 'رموز الطوارئ — لوحة أرمادا ريزيدنس',
  fileNote: 'لكل رمز استخدام واحد. احفظ هذا الملف في مكان آمن.',
};

/** /security «الأمان» and the users screen */
export const SECURITY_TEXT = {
  title: 'الأمان',
  method: 'طريقة التحقق في هذه الجلسة',
  methods: { code: 'رمز البريد', device: 'جهاز متذكَّر', backup: 'رمز طوارئ', totp: 'تطبيق المصادقة' } as Record<string, string>,
  devices: 'الأجهزة المتذكَّرة',
  devicesIntro: 'على هذه الأجهزة لا يُطلب رمز البريد حتى تنتهي مدتها، وهي 30 يومًا من تذكّرها.',
  noDevices: 'لا أجهزة متذكَّرة.',
  thisDevice: 'هذا الجهاز',
  since: 'تذكّر منذ',
  lastUsed: 'آخر استخدام',
  expires: 'ينتهي',
  revoke: 'إلغاء الأجهزة المتذكَّرة',
  revokeSelfBody: 'سيُطلب رمز البريد عند الدخول التالي على كل جهاز. تبقى هذه الجلسة مفتوحة.',
  revokeUserBody: (name: string) => `سيُطلب رمز البريد من «${name}» عند الدخول التالي على كل جهاز، وتنتهي الجلسات المفتوحة لهذا الحساب في اللوحة.`,
  revokeGo: 'إلغاء الأجهزة',
  revoked: 'أُلغيت الأجهزة المتذكَّرة',
  backup: 'رموز الطوارئ',
  backupLeft: (n: number) => `الرموز المتبقية: ${n} من 10`,
  backupNone: 'لا توجد رموز طوارئ صالحة.',
  usersIntro: 'يدخل كل مستخدم بكلمة المرور ثم رمز من 6 أرقام يصل إلى بريده؛ «تذكّر هذا الجهاز» يعفيه من الرمز 30 يومًا على ذلك الجهاز. لمدير النظام رموز طوارئ تفتح الدخول إن تعطّل البريد.',
  userDevices: (n: number) => `الأجهزة المتذكَّرة: ${devicesWord(n)}`,
  userLastCode: 'آخر دخول برمز البريد',
  userBackup: (n: number) => `رموز الطوارئ: ${n} من 10`,
};
