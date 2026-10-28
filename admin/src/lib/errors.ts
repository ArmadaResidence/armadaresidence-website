// Every message staff can see for a failure, in Arabic (approved copy, Ahmed 26 Oct 2026). Staff never see a function
// name, an SQL error or English technical detail: a refusal the database or a function raises on purpose maps to its
// Arabic sentence; «القيمة غير صالحة: {detail}» carries a detail only from the known list below; anything else is the
// generic line, and the technical detail goes to the console only.

export const CONNECTION = 'تعذّر الاتصال بالخادم — تحقق من الشبكة وأعد المحاولة.';
export const SESSION_ENDED = 'انتهت الجلسة، سجّل الدخول مرة أخرى';
export const GENERIC = 'تعذّر إكمال العملية، أعد المحاولة. إن تكرر الخطأ فتواصل مع مدير النظام.';
const INVALID = 'القيمة غير صالحة.';

type Raw = { message?: string; code?: string; details?: string; hint?: string; status?: number } | null | undefined;

/** The known invalid-value refusals (the SQL functions raise them with errcode 22023) → their Arabic detail. */
const INVALID_DETAIL: [RegExp, string][] = [
  [/^settings\.extra_bed_per_night/, 'سعر السرير الإضافي رقم من 0 إلى 1000'],
  [/^settings\.instant_limits/, 'آخر وقت بصيغة ساعة:دقيقة، وأقصى مدة إقامة من 1 إلى 366 ليلة'],
  [/^settings\.breakfast\.child_tiers/, 'شرائح الأطفال بأعمار تصاعدية من 0 إلى 17 وسعر لا يقل عن صفر'],
  [/^settings\.breakfast/, 'سعر إفطار البالغ من 0 إلى 1000 وشرائح الأطفال مطلوبة'],
  [/^settings\.(show_prices|instant_booking)/, 'تشغيل أو إيقاف لكل فرع'],
  [/^settings\.rate_high_multiplier/, 'مضاعف تنبيه السعر المرتفع عدد صحيح من 2 إلى 1000'],
  [/^rooms 0/, 'عدد الغرف من 0 إلى 999'],
  [/^rate 0|^price$/, 'السعر أكبر من صفر وأقل من 100000'],
  [/^weekdays/, 'اختر يومًا واحدًا على الأقل من أيام الأسبوع'],
  [/^full_name/, 'الاسم من 2 إلى 80 حرفًا'],
  [/^email, full_name and role/, 'البريد والاسم والدور مطلوبة'],
  [/^label 1/, 'التسمية حتى 80 حرفًا'],
];

/** Refusals that are whole sentences of their own. */
const KNOWN: [RegExp, string][] = [
  [/last_admin/, 'لا يمكن إيقاف أو تنزيل آخر مدير نظام فعّال.'],
  [/already_reverted/, 'هذا التغيير مُسترجَع من قبل.'],
  [/not_revertable/, 'تأكيد الحجز وإلغاؤه لا يُستَرجَعان (أُرسلت رسائل بريد).'],
  [/^conflict/, 'تغيّرت القيم بعد هذا التعديل، لم يُسترجع شيء.'],
  [/^not_found/, 'لم يُعثر على هذا التغيير.'],
  [/^past$/, 'لا يمكن تعديل ليالٍ ماضية.'],
  [/^range/, 'الفترة خارج الحد المسموح.'],
  [/^nothing to change/, 'لا تغيير لحفظه.'],
  [/^a reason is required/, 'اكتب سبب الإلغاء.'],
  [/^not a request/, 'تغيّرت حالة هذا الحجز؛ أعد فتحه.'],
  [/^choose a bookable room type/, 'اختر نوع غرفة متاحًا للحجز في هذا الفرع.'],
  [/^choose a room type/, 'اختر نوع الغرفة.'],
  [/^no such user/, 'لم يُعثر على هذا المستخدم.'],
  [/already (been )?registered|already exists/i, 'هذا البريد له حساب في اللوحة من قبل.'],
  // phase 2a.2 (26 Oct 2026): backup codes and site defaults
  [/^fresh_code_required/, 'للأمان أدخل رمزًا جديدًا من بريدك قبل إنشاء رموز الطوارئ.'],
  [/^defaults_changed/, 'تغيّرت الإعدادات منذ فتح النافذة؛ راجع القائمة المحدّثة ثم أعد المحاولة.'],
  [/^ack_switches/, 'أكّد أولًا أن المفاتيح ستُفعَّل على الموقع.'],
];

/** Arabic message for a database or function refusal; `what` (the call) goes to the console only. */
export function arabicError(e: Raw, what: string): string {
  const m = e?.message ?? '';
  if (e?.code === '42501' || /not allowed|permission denied|users:edit only/i.test(m)) return 'لا صلاحية لهذا الإجراء.';
  if (e?.code === 'PGRST301' || /jwt expired|^sign in$/i.test(m)) return SESSION_ENDED;
  const changed = m.match(/^changed:(\d+)/);
  if (changed) return `تغيّرت الخلية أثناء التعديل (المتبقي الآن ${changed[1]}). أغلق وأعد الفتح.`;
  for (const [re, text] of KNOWN) if (re.test(m)) return text;
  const detail = INVALID_DETAIL.find(([re]) => re.test(m));
  if (detail) return `القيمة غير صالحة: ${detail[1]}.`;
  console.error(`[${what}]`, e);
  if (/failed to fetch|network|load failed/i.test(m)) return CONNECTION;
  if (e?.code === '22023' || /^settings\./.test(m)) return INVALID;
  return GENERIC;
}

// The password rule and its texts (8+ printable ASCII characters, no spaces; the checklist lines and the weak / leaked
// refusal «كلمة المرور هذه شائعة أو ظهرت في تسريبات سابقة…») live in password.ts since 26 Oct 2026 — the one other
// file with staff-facing text; this file keeps every failure message.

const CREDENTIAL_CODES = ['invalid_credentials', 'user_not_found', 'signup_disabled', 'email_address_invalid'];

/** The Supabase Auth messages a user can meet on the login, MFA and set-password pages. A login never tells whether
 * an email is registered: an unknown user and every credential failure read the same. */
export function arabicAuth(e: Raw): string {
  const m = e?.message ?? '';
  if (CREDENTIAL_CODES.includes(e?.code ?? '') || /invalid login credentials|user not found|signups not allowed|invalid email|invalid credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/email not confirmed/i.test(m)) return 'الحساب لم يُفعَّل بعد: افتح رابط الدعوة من بريدك أولًا.';
  if (e?.code === 'over_request_rate_limit' || e?.status === 429 || /rate limit|security purposes|too many/i.test(m)) return 'محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة.';
  if (/failed to fetch|network|load failed/i.test(m)) return CONNECTION;
  console.error('[auth]', e);
  return GENERIC;
}
