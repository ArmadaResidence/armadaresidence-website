// The dashboard's guided tour (Ahmed, 4 Nov 2026 — DECISIONS.md 2026-11-04 «Guided tour»). Arabic only. Each step
// points at existing controls marked with `data-tour` tokens (`[data-tour~="…"]`); a step lists fallbacks (the first
// whose element is on screen wins) and every match of that selector is spotlit together (one rectangle around them).
// A step the user cannot see — no permission, or not on screen — is left out before the tour starts, so «2 من 5»
// counts only the steps shown. A step may `open` something first (the first booking request, enquiry or guest): the
// tour clicks it, waits for the target and closes what it opened when it ends. Texts are Ahmed's (4 Nov 2026); where a
// control works differently the text follows the control (DECISIONS.md lists each change).
import type { Me } from './api';
import { canEdit } from './api';

export const t = (token: string) => `[data-tour~="${token}"]`;

export interface TourStep {
  /** CSS selectors in order of preference; the first with an element on screen wins (all its matches are spotlit) */
  target: string[];
  title: string;
  text: string;
  /** a permission the step needs beyond seeing its target */
  needs?: (me: Me | null) => boolean;
  /** clicked first when the target is not on screen (opens a drawer); the step counts only if this is on screen */
  open?: string;
}
export interface Tour {
  id: string;
  /** the welcome tour starts by itself and offers «لا تعرض الجولة مرة أخرى»; page tours run only from «؟» */
  welcome?: boolean;
  steps: TourStep[];
}

export const WELCOME: Tour = {
  id: 'welcome',
  welcome: true,
  steps: [
    // on phones the sidebar lives in the drawer: the menu button stands in for it
    { target: [t('sidebar'), t('nav-open')], title: 'القائمة', text: 'من هنا تنتقل بين أقسام اللوحة. تظهر لك فقط الأقسام المسموح لك بها.' },
    { target: [t('overview-cards')], title: 'ملخص اليوم', text: 'الوصول والمغادرة والطلبات المنتظرة. اضغط أي بطاقة لتفتح قائمتها مباشرة.' },
    { target: [t('overview-alerts')], title: 'التنبيهات', text: 'كل ما يحتاج تصرّفًا اليوم في مكان واحد. ابدأ يومك من هنا.' },
    { target: [t('nav-bookings'), t('nav-open')], title: 'الحجوزات', text: 'كل حجز أو طلب يصل من الموقع يظهر هنا فورًا. فعّل إشعار المتصفح من قائمة حسابك حتى لا يفوتك شيء.' },
    { target: [t('help')], title: 'المساعدة', text: 'من هذا الزر تعيد الجولة أو تفتح شرح الصفحة التي أنت فيها، في أي وقت.' },
  ],
};

const editBookings = (me: Me | null) => canEdit(me, 'bookings');
const editRooms = (me: Me | null) => canEdit(me, 'rooms');
export const PAGE_TOURS: Record<string, Tour> = {
  '/bookings': {
    id: 'bookings',
    steps: [
      { target: [t('booking-filters')], title: 'الفلاتر', text: 'اعرض الحجوزات حسب الحالة والفرع والتاريخ.' },
      { target: [t('booking-row')], title: 'تفاصيل الحجز', text: 'اضغط أي حجز لتفتح تفاصيله: الضيف والليالي والسعر والملاحظات الداخلية.' },
      // the confirm button lives in a request's details: the tour opens the first request in the list
      { target: [t('booking-confirm')], open: t('booking-request-row'), needs: editBookings, title: 'التأكيد', text: 'التأكيد يخصم من المخزون ويرسل التأكيد للضيف بالبريد وواتساب، ولا يمكن التراجع عنه.' },
      { target: [t('booking-confirm')], open: t('booking-request-row'), needs: editBookings, title: 'بعد كل حجز مؤكد', text: 'أغلق الغرفة نفسها على Booking.com والمنصات الأخرى فورًا، حتى لا تُباع مرتين.' },
      // 10 Nov 2026: «حذف نهائي» — the system admin only, in the details of a booking cancelled as «حجز تجريبي»
      { target: [t('booking-delete-test')], open: t('booking-test-row'), needs: (me) => me?.role === 'admin', title: 'حذف حجز تجريبي', text: 'يظهر «حذف نهائي» لك وحدك، وعلى الحجوزات الملغاة بسبب «حجز تجريبي» فقط. اكتب رقم الحجز للتأكيد، فيختفي من كل القوائم والتقارير، ويمكنك استرجاعه من «السجل».' },
    ],
  },
  // 10 Nov 2026: room types managed from «الغرف» (DECISIONS.md 2026-11-10 «Room types from the dashboard»)
  '/rooms': {
    id: 'rooms',
    steps: [
      { target: [t('room-row')], title: 'أنواع الغرف', text: 'كل نوع غرفة في الفرع: اسمه وسعته وسعره الأساسي وعدد وحداته الفعلي ورابط صفحته على الموقع.' },
      { target: [t('room-add')], needs: editRooms, title: 'إضافة نوع غرفة', text: 'أضف نوعًا جديدًا بالاسمين والمساحة والسرير والسعة والسعر والوحدات والمزايا والوصفين. يبدأ مخفيًا من الموقع حتى تُظهره.' },
      { target: [t('room-edit')], title: 'تعديل', text: 'عدّل أي بيانات للنوع، والاسم أيضًا. رابط الصفحة لا يتغير بتغيير الاسم، والحجوزات القديمة تحتفظ بالاسم الذي حُجزت به.' },
      { target: [t('room-units')], title: 'عدد الوحدات', text: 'إجمالي الفرع على الموقع هو مجموع الوحدات الفعلية للأنواع الظاهرة. المخزون المفتوح على الموقع لا يزيد أبدًا عن العدد الفعلي.' },
      { target: [t('room-visibility')], needs: editRooms, title: 'إظهار وإخفاء', text: 'لا يظهر النوع على الموقع إلا مكتملًا: الاسمان والوصفان والسعر الأساسي وعدد الوحدات وصورة غلاف منشورة في «الصور». ستظهر لك قائمة بما ينقص.' },
      { target: [t('room-order')], needs: editRooms, title: 'الترتيب', text: 'رتّب الأنواع داخل الفرع؛ الموقع ونموذج الحجز يعرضانها بهذا الترتيب.' },
      { target: [t('room-delete')], needs: editRooms, title: 'الحذف', text: 'يُحذف النوع الذي لم يُحجز أبدًا فقط. النوع الذي له حجز يُخفى ولا يُحذف. وكل تغيير هنا يمكن التراجع عنه من «تراجع» أو من «السجل».' },
    ],
  },
  '/inventory': {
    id: 'inventory',
    steps: [
      { target: [t('cal-cell')], title: 'الخانة', text: 'الرقم الأول هو المتبقي للبيع على الموقع، والثاني هو المحجوز.' },
      { target: [t('row-open-close')], title: 'فتح وإغلاق', text: 'الليلة المغلقة لا تُباع على الموقع، ويبقى عددها محفوظًا حتى تفتحها.' },
      // the button reads «تعديل جماعي» (the brief's «تعديل لفترة» named it differently)
      { target: [t('cal-bulk')], title: 'تعديل جماعي', text: 'غيّر المتبقي أو افتح وأغلق عدة ليالٍ وأنواع غرف مرة واحدة.' },
      { target: [t('cal-grid')], title: 'إذا بِعت خارج الموقع', text: 'عند أي حجز من Booking.com أو من الفندق، خفّض المتبقي هنا فورًا حتى لا يبيعه الموقع مرة ثانية.' },
    ],
  },
  '/rates': {
    id: 'rates',
    steps: [
      { target: [t('base-rate')], title: 'السعر الأساسي', text: 'السعر الذي يُستخدم لأي ليلة ليس لها سعر خاص.' },
      { target: [t('cal-bulk')], title: 'سعر لفترة', text: 'حدّد سعرًا لأيام بعينها، مثل الويكند أو موسم، لنوع غرفة أو أكثر.' },
      // the warning appears wherever a price is entered (a night of the grid or «سعر لفترة»): only for those who can edit
      { target: [t('cal-grid')], needs: (me) => canEdit(me, 'rates'), title: 'تنبيه السعر', text: 'إذا كان السعر بعيدًا عن المعتاد ستظهر لك رسالة للتأكد قبل الحفظ.' },
    ],
  },
  '/partners': {
    id: 'partners',
    steps: [
      { target: [`${t('partner-status')}, label[for="pf-status"]`], title: 'حالة الطلب', text: 'تابع كل طلب من «جديد» حتى «مؤكد» أو «لم يتم».' },
      // logging a contact and attaching a file need edit; both live in an enquiry's details
      { target: [t('partner-contact')], open: t('partner-row'), needs: (me) => canEdit(me, 'partners'), title: 'أول تواصل', text: 'التواصل من أزرار واتساب أو البريد أو الاتصال داخل الطلب يسجّل وقت أول تواصل تلقائيًا.' },
      { target: [t('partner-quote')], open: t('partner-row'), needs: (me) => canEdit(me, 'partners'), title: 'عرض السعر', text: 'أرفق ملف عرض السعر PDF داخل الطلب ليبقى مع سجله.' },
    ],
  },
  '/guests': {
    id: 'guests',
    steps: [
      // the search also matches the email
      { target: [`${t('guest-search')}, label[for="gf-q"]`], title: 'البحث', text: 'ابحث عن أي ضيف بالاسم أو الجوال أو البريد.' },
      { target: [t('guest-row')], title: 'ملف الضيف', text: 'إقاماته وإنفاقه وموافقته على العروض في مكان واحد.' },
      // the in-person consent is recorded from the guest's profile (here) as well as from a booking's details
      { target: [t('guest-consent')], open: t('guest-row'), needs: (me) => canEdit(me, 'guests'), title: 'الموافقة الحضورية', text: 'إذا وافق الضيف أمامك على تلقي العروض، سجّلها من ملفه هنا أو من تفاصيل الحجز.' },
    ],
  },
  // 13 Nov 2026: «إعدادات المساعد» of «مركز الضيوف» (Guest Hub H1) — nothing switches on yet
  '/assistant': {
    id: 'assistant',
    steps: [
      { target: [t('hub-switches')], title: 'المفاتيح العامة', text: '«المساعد يعمل» و«تخزين المحادثات» متوقفان. لا يقبل الخادم تشغيلهما قبل أن يُبنى ما ينقصهما في الجلسات القادمة، وتظهر تحت كل مفتاح قائمة بما ينقصه.' },
      { target: [t('hub-units')], title: 'الوحدات', text: 'أربع وحدات: الفرعان، ومقهى اللوبي والمطعم العلوي مخفيان حتى يحين وقتهما. الوحدة المخفية لا تُشغَّل أبدًا.' },
      { target: [t('hub-verify')], needs: (me) => canEdit(me, 'assistant') && me?.branch === null, title: 'تحقق من القناة', text: 'يقرأ رقم واتساب من YCloud ويسجل جودته وحد رسائله. قراءة فقط، لا يغيّر شيئًا في YCloud.' },
      { target: [t('hub-team')], title: 'الفريق', text: 'فريق الوحدة وحده يرى محادثاتها لاحقًا. استقبال كل فرع في وحدة فرعه فقط.' },
      { target: [t('hub-mode')], title: 'وضع المساعد', text: 'متوقف، تجربة، بموافقة الفريق، رد تلقائي. كلها متوقفة الآن، ويظهر تحت كل وحدة ما ينقصها قبل التشغيل.' },
      { target: [t('hub-templates')], title: 'قوالب واتساب', text: '«تحديث حالة القوالب» يقرأ القوالب المعتمدة لكل رقم من YCloud. لن يرسل المركز إلا قالبًا معتمدًا على رقمه.' },
      { target: [t('hub-summary')], title: 'ملخص الصباح', text: 'من يصله بريد الملخص اليومي. لا يُفعَّل عنوان قبل تأكيد فلتر صندوقه.' },
      { target: [t('hub-alerts')], title: 'التنبيهات', text: 'تنبيهات المركز تظهر هنا وتصل بالبريد، ولا تُرسل بواتساب أبدًا.' },
    ],
  },
  '/reports': {
    id: 'reports',
    steps: [
      { target: [`${t('report-period')}, label[for="rp-period"], label[for="rp-cmp"]`], title: 'الفترة والمقارنة', text: 'اختر الفترة وما تقارنها به، وتتغير كل الأرقام معها.' },
      { target: ['[data-section="performance"] [data-how]'], title: 'كيف نحسب', text: 'اضغط هذه العلامة لتعرف كيف حُسب الرقم.' },
      { target: [t('report-export')], title: 'التصدير', text: 'نزّل التقرير Excel أو اطبعه PDF.' },
    ],
  },
};

/** the page tour of a path (none for the others: «شرح هذه الصفحة» is hidden there) */
export const pageTour = (pathname: string): Tour | null => PAGE_TOURS[pathname.replace(/\/+$/, '') || '/'] ?? null;

/** «2 من 5» */
export const stepCounter = (i: number, n: number) => `${i + 1} من ${n}`;

// ── DOM helpers (also used by the e2e through the same selectors) ──
/** on screen = rendered with a box, not hidden, not inside an inert or aria-hidden subtree we did not make inert */
export function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  return el.getClientRects().length > 0;
}
/** the elements a step spotlights: every on-screen match of its first selector that has one */
export function stepElements(step: TourStep): HTMLElement[] {
  for (const sel of step.target) {
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(onScreen);
    if (els.length) return els;
  }
  return [];
}
export function openerOf(step: TourStep): HTMLElement | null {
  if (!step.open) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(step.open)).find(onScreen) ?? null;
}
/** a step is shown when the user may use it and its target (or what opens it) is on screen */
export function available(step: TourStep, me: Me | null): boolean {
  if (step.needs && !step.needs(me)) return false;
  return stepElements(step).length > 0 || !!openerOf(step);
}
