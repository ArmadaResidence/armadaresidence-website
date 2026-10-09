/**
 * Copy for the Travel Trade Fact Sheet 2026 (scripts/fact-sheet.mjs), page by page as in brand/fact-sheet/
 * (the original PDFs), with the seven corrections from content/partners.json → fact_sheet.corrections applied.
 * Every figure is injected from content/ by the generator — this module holds wording only; `{tokens}` are filled there.
 */
export const COPY = {
  lockup: { en: 'Armada Residence Hotels', ar: 'فنادق أرمادا ريزيدنس' },
  lockupSub: { en: 'TAIF · SAUDI ARABIA', ar: 'ARMADA RESIDENCE HOTELS' },
  region: { en: 'TAIF · KINGDOM OF SAUDI ARABIA', ar: 'الطائف · المملكة العربية السعودية' },
  page: { en: 'PAGE', ar: '' },

  cover: {
    eyebrow: { en: 'THE DOCUMENT', ar: 'المستند' },
    docTitle: { en: 'Travel Agent Fact Sheet', ar: 'TRAVEL TRADE FACT SHEET' },
    edition: { en: 'EDITION 2026', ar: 'إصدار 2026' },
    h1a: { en: 'Armada Residence', ar: 'فنادق أرمادا ريزيدنس' },
    h1b: { en: 'Hotels', ar: 'ملف الحقائق لوكلاء السفر' },
    tagline: {
      en: 'Welcome, partners. We are not looking for a booking — we are looking for a <b>partnership</b> that returns every season.',
      ar: 'أهلاً بكم شركاء — لا نبحث عن حجزٍ واحد، بل عن <b>شراكة</b> تعود كل موسم',
    },
    stats: [
      { label: { en: 'Properties', ar: 'الفنادق' }, value: { en: 'Two', ar: 'فندقان' } },
      { label: { en: 'Combined units', ar: 'إجمالي الوحدات' }, value: '{units_total}' },
      { label: { en: 'Unit types', ar: 'أنواع الوحدات' }, value: '{room_types}' },
      { label: { en: 'City', ar: 'المدينة' }, value: { en: 'Taif', ar: 'الطائف' } },
    ],
  },

  proposition: {
    section: { en: 'The Proposition', ar: 'الفكرة' },
    eyebrow: { en: 'THE PROPOSITION', ar: 'الفكرة باختصار' },
    h2: { en: 'Two hotels in Taif.<br>One for groups.<br>One for families.', ar: 'فندقان في الطائف.<br>واحد للمجموعات.<br>وآخر للعائلات.' },
    body: {
      en: 'That is the whole proposition. You are not choosing between two similar addresses — you are choosing the one that matches the programme in your hand.<br>And when a programme needs both, you book them under one agreement, one rooming list and one commercial contact.',
      ar: 'أنتم لا تختارون بين عنوانين متشابهين — بل تختارون الفندق الذي يطابق البرنامج الذي بين أيديكم. وحين يحتاج البرنامج إليهما معاً، تحجزونهما تحت اتفاقية واحدة، وقائمة تسكين واحدة، وجهة اتصال تجارية واحدة',
    },
    airport: {
      name: { en: 'Airport Road', ar: 'طريق المطار' },
      unit: { en: 'APARTMENTS', ar: 'شقة فندقية' },
      body: {
        en: '{corridor}. The larger inventory, multi-bed rooming, an equipped function hall and parking that takes a coach.',
        ar: '{corridor}. السعة الأكبر، وتسكين متعدد الأسرّة، وقاعة مجهّزة، ومواقف تتّسع لحافلة',
      },
      tags: [{ en: 'GROUPS', ar: 'المجموعات' }, { en: 'BUSINESS', ar: 'الأعمال' }, { en: 'UMRAH TRANSIT', ar: 'عبور العمرة' }, { en: 'LONG STAY', ar: 'الإقامة الطويلة' }],
    },
    shafa: {
      name: { en: 'Al Shafa Road', ar: 'طريق الشفا' },
      unit: { en: 'UNITS · {beds_shafa} BEDS', ar: 'وحدة · {beds_shafa} سريراً' },
      body: {
        en: 'A residential quarter in Al-Sadad, {ruddaf_words} minutes from Al Ruddaf Park. Quieter, smaller, and built around family stays rather than movement.',
        ar: 'حي سكني في السداد، على بعد {ruddaf_words} دقائق من حديقة الردف. أهدأ وأصغر، وقائم على إقامة العائلة لا على الحركة',
      },
      tags: [{ en: 'FAMILIES', ar: 'العائلات' }, { en: 'LEISURE', ar: 'الترفيه' }, { en: 'TOURISM', ar: 'السياحة' }, { en: 'EXTENDED STAY', ar: 'الإقامة الممتدة' }],
    },
  },

  glance: {
    section: { en: 'At a Glance', ar: 'نظرة سريعة' },
    h2: { en: 'The group<br>in numbers.', ar: 'المجموعة<br>في أرقام.' },
    sub: { en: 'Every figure is taken from the properties’ own records. Nothing is estimated and nothing is rounded up.', ar: 'كل رقم مأخوذ من سجلات الفندقين. لا تقدير، ولا تقريب إلى الأعلى' },
    welcomeTitle: { en: 'Welcome, partners', ar: 'أهلاً بكم شركاء' },
    welcome: {
      en: 'We meet travel agents and tour operators as <b>partners, not accounts</b>. A partnership starts with information you can build on.',
      ar: 'نستقبل وكلاء السفر ومنظّمي الرحلات <b>شركاء لا عملاء</b>. الشراكة تبدأ من معلومة يمكنكم البناء عليها',
    },
    stats: [
      { n: '{units_airport}', l: { en: 'Apartments', ar: 'شقة فندقية' }, s: { en: 'Airport Road', ar: 'طريق المطار' } },
      { n: '{units_shafa}', l: { en: 'Units', ar: 'وحدة' }, s: { en: 'Al Shafa Road', ar: 'طريق الشفا' } },
      { n: '{beds_shafa}', l: { en: 'Beds', ar: 'سرير' }, s: { en: 'Al Shafa Road', ar: 'طريق الشفا' } },
      { n: '{room_types}', l: { en: 'Unit types', ar: 'أنواع وحدات' }, s: { en: '{types_airport} Airport Road · {types_shafa} Al Shafa Road', ar: '{types_airport} طريق المطار · {types_shafa} طريق الشفا' } },
      { n: '{suite_capacity}', l: { en: 'Guests', ar: 'ضيوف' }, s: { en: 'Two-bedroom suite', ar: 'جناح الغرفتين' } },
      { n: '{hall_capacity}', l: { en: 'Capacity', ar: 'سعة' }, s: { en: 'Function hall', ar: 'قاعة المناسبات' } },
    ],
    combined: {
      en: 'Combined, the two properties hold <b>{units_total} units</b> in Taif — enough to place a full tour group, a corporate programme and a family party in the same city on the same night, under one file.',
      ar: 'يضمّ الفندقان معاً <b>{units_total} وحدة</b> في الطائف — بما يكفي لتسكين مجموعة سياحية كاملة، وبرنامج شركة، ووفد عائلي، في المدينة نفسها والليلة نفسها، تحت ملف واحد',
    },
    services: [
      { t: { en: 'Complimentary Wi-Fi', ar: 'إنترنت مجاني' }, s: { en: 'All units and public areas, both hotels', ar: 'كل الوحدات والمرافق في الفندقين' } },
      { t: { en: '24-hour reception & security', ar: 'استقبال وأمن على مدار الساعة' }, s: { en: 'Organised group check-in and check-out', ar: 'وصول ومغادرة جماعية منظّمة' } },
      { t: { en: 'Daily housekeeping', ar: 'نظافة يومية' }, s: { en: '24-hour room service', ar: 'خدمة غرف على مدار الساعة' } },
    ],
  },

  airport: {
    section: { en: 'Airport Road', ar: 'طريق المطار' },
    eyebrow: { en: 'PROPERTY ONE', ar: 'الفندق الأول' },
    h2: { en: 'Airport Road', ar: 'طريق المطار' },
    lead: {
      en: 'One hundred and eight hotel apartments {corridor_lc}. This is the property we place organised groups in — the larger inventory, the multi-bed rooming, the function hall, and parking that accommodates a tour coach.',
      ar: 'مئة وثماني شقق فندقية {corridor}. الفندق الذي نُسكن فيه المجموعات المنظّمة — السعة الأكبر، والتسكين متعدد الأسرّة، والقاعة المجهّزة، والمواقف التي تتّسع لحافلة سياحية',
    },
    stats: [
      { n: '{units_airport}', l: { en: 'APARTMENTS', ar: 'شقة' } },
      { n: '{types_airport}', l: { en: 'UNIT TYPES', ar: 'أنواع' } },
      { n: '{hall_capacity}', l: { en: 'HALL CAPACITY', ar: 'سعة القاعة' } },
      { n: '{airport_min}', l: { en: 'MIN TO AIRPORT', ar: 'دقيقة للمطار' } },
    ],
    feats: [
      { t: { en: 'Function hall', ar: 'قاعة المناسبات' }, s: { en: '{hall_short}', ar: '{hall_short}' } },
      { t: { en: 'Restaurant & coffee shop', ar: 'المطعم والكوفي شوب' }, s: { en: 'Group buffets served in-house', ar: 'بوفيهات المجموعات داخل الفندق' } },
      { t: { en: 'Coach parking', ar: 'مواقف الحافلات' }, s: { en: 'On-site, tour-coach capacity', ar: 'داخل الفندق وتتّسع للحافلات' } },
      { t: { en: 'Free Wi-Fi', ar: 'إنترنت مجاني' }, s: { en: 'All units and public areas', ar: 'في كل الوحدات والمرافق' } },
      { t: { en: '24-hour reception', ar: 'استقبال 24 ساعة' }, s: { en: 'Organised group arrivals', ar: 'وصول جماعي منظّم' } },
      { t: { en: 'Laundry service', ar: 'خدمة المغسلة' }, s: { en: 'Available throughout the stay', ar: 'متاحة طوال الإقامة' } },
    ],
    captions: {
      exterior: { en: 'AIRPORT ROAD, {district_airport} DISTRICT, TAIF {postal_airport}', ar: 'طريق المطار، حي {district_airport}، الطائف {postal_airport}' },
      majlis: { en: 'THE HERITAGE MAJLIS', ar: 'المجلس التراثي' },
      suite: { en: 'SUITE LIVING ROOM', ar: 'صالة الجناح' },
    },
  },

  units: {
    section: { en: 'The Unit Collection', ar: 'مجموعة الوحدات' },
    h2: { en: 'Twelve unit types. Eight ways to place a guest.', ar: 'اثنا عشر نوعًا من الوحدات. ثماني طرق لتسكين الضيف.' },
    cols: [
      { en: 'Unit type', ar: 'نوع الوحدة' },
      { en: 'Occupancy', ar: 'الإشغال' },
      { en: 'Bedding', ar: 'الأسرّة' },
      { en: 'Property', ar: 'الفندق' },
      { en: 'Best for', ar: 'لمن تصلح' },
    ],
    note: {
      en: 'Unit counts per type are confirmed with each enquiry — combined inventory is <b>{units_total} units</b> across the two properties.',
      ar: 'يُؤكَّد عدد الوحدات لكل نوع مع كل طلب — وإجمالي المعروض <b>{units_total} وحدة</b> في الفندقين',
    },
  },

  inUnit: {
    section: { en: 'In Every Unit', ar: 'داخل كل وحدة' },
    h2: { en: 'One standard, across both hotels.', ar: 'تجهيز واحد، في الفندقين.' },
    items: [
      { en: 'Smart TV — {tv_airport}" Airport Road · {tv_shafa}" Al Shafa', ar: 'شاشة ذكية — {tv_airport} بوصة في طريق المطار و{tv_shafa} بوصة في الشفا' },
      { en: 'Air conditioning · in-room safety deposit box', ar: 'تكييف · خزنة أمانات داخل الغرفة' },
      { en: 'Iron · electric kettle · refrigerator at Airport Road', ar: 'مكواة · غلاية مياه · ثلاجة في طريق المطار' },
      { en: 'Free Wi-Fi in every unit', ar: 'إنترنت مجاني في كل وحدة' },
      { en: 'Daily housekeeping', ar: 'نظافة يومية' },
      { en: '24-hour room service · laundry service', ar: 'خدمة غرف على مدار الساعة · خدمة مغسلة' },
      { en: 'Kitchen in the Airport Road one- and two-bedroom suites', ar: 'مطبخ في أجنحة طريق المطار بغرفة أو غرفتين' },
      { en: 'Accessible room at each property — availability on enquiry', ar: 'غرفة لذوي الهمم في كل فندق — يُؤكَّد التوافر عند الطلب' },
    ],
    photos: [
      ['king-airport', { en: 'KING ROOM — AIRPORT', ar: 'غرفة كينج — المطار' }],
      ['twin-airport', { en: 'TWIN ROOM — AIRPORT', ar: 'غرفة بسريرين — المطار' }],
      ['suite-two-bed', { en: 'TWO-BEDROOM SUITE', ar: 'جناح غرفتين وصالة' }],
      ['king-shafa', { en: 'KING ROOM — AL SHAFA', ar: 'غرفة كينج — الشفا' }],
    ],
  },

  shafa: {
    section: { en: 'Al Shafa Road', ar: 'طريق الشفا' },
    eyebrow: { en: 'PROPERTY TWO', ar: 'الفندق الثاني' },
    h2: { en: 'Al Shafa Road', ar: 'طريق الشفا' },
    lead: {
      en: 'Sixty units in Al-Sadad, an established residential quarter — quieter and smaller than Airport Road, {ruddaf_words} minutes from Al Ruddaf Park.',
      ar: 'ستون وحدة على طريق الشفا في حي السداد — أحد أحياء الطائف السكنية العريقة. أهدأ وأصغر من طريق المطار، وعلى بعد {ruddaf_words} دقائق من حديقة الردف',
    },
    stats: [
      { n: '{units_shafa}', l: { en: 'UNITS', ar: 'وحدة' } },
      { n: '{beds_shafa}', l: { en: 'BEDS', ar: 'سريراً' } },
      { n: '{ruddaf_min}', l: { en: 'MIN · AL RUDDAF', ar: 'دقائق لحديقة الردف' } },
      { n: '{zoo_min}', l: { en: 'MIN · TAIF ZOO', ar: 'دقائق لحديقة الحيوانات' } },
    ],
    cards: [
      { img: 'king-shafa', t: { en: 'King Room', ar: 'غرفة كينج' }, o: { en: '2 GUESTS', ar: 'ضيفان' }, s: { en: '{bed_king_shafa}', ar: '{bed_king_shafa}' } },
      { img: null, t: { en: 'Balcony Room', ar: 'غرفة مع بلكونة' }, o: { en: '2 GUESTS', ar: 'ضيفان' }, s: { en: '{bed_balcony} · private balcony', ar: '{bed_balcony} · بلكونة خاصة' } },
      { img: 'jacuzzi-shafa', t: { en: 'Jacuzzi Studio', ar: 'استديو بجاكوزي' }, o: { en: '2 GUESTS', ar: 'ضيفان' }, s: { en: '{bed_jacuzzi} · jacuzzi', ar: '{bed_jacuzzi} · جاكوزي' } },
      { img: 'king-junior', t: { en: 'Suites', ar: 'الأجنحة' }, o: { en: 'UP TO {suite_capacity} GUESTS', ar: 'حتى {suite_capacity} ضيوف' }, s: { en: 'One- and two-bedroom suites', ar: 'أجنحة بغرفة أو غرفتين' } },
    ],
    exteriorCaption: { en: 'AL SHAFA ROAD — TAIF', ar: 'طريق الشفا — الطائف' },
    barTitle: { en: 'Restaurant & café', ar: 'المطعم والكوفي' },
    bar1: { en: ' — daily breakfast buffet {breakfast_hours}', ar: ' — بوفيه إفطار يومي {breakfast_hours}' },
    bar2: {
      en: 'Free parking (basement level) · laundry · daily housekeeping · 24-hour security · {address_shafa}',
      ar: 'مواقف مجانية (الطابق السفلي) · مغسلة · نظافة يومية · أمن على مدار الساعة · {address_shafa}',
    },
  },

  groups: {
    section: { en: 'Groups & Travel Trade', ar: 'المجموعات وقطاع السفر' },
    h2: { en: 'Your group. Our priority.', ar: 'مجموعتكم أولويتنا.' },
    intro: {
      en: 'A group is not a stack of individual bookings. It arrives together, eats together and leaves together — and it is run from one written plan issued to every department before the group lands.',
      ar: 'المجموعة ليست كومة حجوزات فردية. تصل معاً، وتأكل معاً، وتغادر معاً — وتُدار بخطة واحدة مكتوبة تُعمَّم على كل قسم قبل وصولها',
    },
    segments: [
      { t: { en: 'Umrah Groups', ar: 'مجموعات العمرة' }, b: [{ en: 'Transit stays on the route towards Makkah', ar: 'إقامات عبور على المسار نحو مكة' }, { en: 'Multi-bed rooming for the whole party', ar: 'تسكين متعدد الأسرّة للوفد كاملاً' }, { en: 'Breakfast for the full group', ar: 'إفطار للمجموعة كاملة' }, { en: 'Coordination agreed before arrival', ar: 'تنسيق يُعتمد قبل الوصول' }] },
      { t: { en: 'Tourist & Leisure', ar: 'السياحة والترفيه' }, b: [{ en: 'Family and multi-generation parties', ar: 'الوفود العائلية ومتعددة الأجيال' }, { en: 'Programmes around Taif attractions', ar: 'برامج حول معالم الطائف' }, { en: 'Operator bookings in one file', ar: 'حجوزات المنظّمين في ملف واحد' }, { en: 'Both properties in one programme', ar: 'الفندقان في برنامج واحد' }] },
      { t: { en: 'Corporate', ar: 'الشركات' }, b: [{ en: 'Business stays with a function hall', ar: 'إقامات عمل مع قاعة مجهّزة' }, { en: 'Company accommodation programmes', ar: 'برامج إسكان الشركات' }, { en: 'Long stays in apartment-style units', ar: 'إقامات طويلة في وحدات بطابع الشقق' }, { en: 'Consolidated billing arranged', ar: 'تسوية حساب موحّدة' }] },
      { t: { en: 'Sports Groups', ar: 'المجموعات الرياضية' }, b: [{ en: 'Teams, federations and tournaments', ar: 'الفرق والاتحادات والبطولات' }, { en: 'Twin rooming that keeps squads together', ar: 'تسكين بسريرين يُبقي الفريق معاً' }, { en: 'Meals around training schedules', ar: 'وجبات حول جدول التمارين' }, { en: 'Hall for technical briefings', ar: 'قاعة للإحاطات الفنية' }] },
      { t: { en: 'Institutional', ar: 'المؤسسية' }, b: [{ en: 'Government and public-sector delegations', ar: 'الوفود الحكومية والقطاع العام' }, { en: 'Educational and training groups', ar: 'المجموعات التعليمية والتدريبية' }, { en: 'NGO and institutional programmes', ar: 'برامج الجمعيات والمؤسسات' }, { en: 'Written event order for every group', ar: 'أمر تشغيل مكتوب لكل مجموعة' }] },
    ],
    note: {
      en: '<b>One written plan, issued before arrival:</b> every confirmed group receives a written event order covering arrival, rooming, meals, hall use and departure — circulated to reception, housekeeping, food &amp; beverage and accounts before the group lands, so no department improvises on the day.',
      ar: '<b>خطة واحدة مكتوبة تصدر قبل الوصول:</b> كل مجموعة مؤكَّدة تحصل على أمر تشغيل مكتوب يغطي الوصول والتسكين والوجبات واستخدام القاعة والمغادرة — يُعمَّم على الاستقبال والهاوسكيبينق والأغذية والمشروبات والحسابات قبل وصول المجموعة، فلا يرتجل أي قسم يوم التنفيذ',
    },
  },

  steps: {
    section: { en: 'How We Run Your Group', ar: 'كيف ندير مجموعتكم' },
    h2: { en: 'Six steps that never change.', ar: 'ستّ خطوات لا تتبدّل.' },
    sub: {
      en: 'From the first message to the final invoice a group is run by one named contact, on one written plan, through six steps that never change.',
      ar: 'من أول رسالة حتى الفاتورة الأخيرة يديرها مسؤول واحد باسمه، بخطة واحدة مكتوبة، عبر ستّ خطوات لا تتبدّل',
    },
    list: [
      { t: { en: 'The enquiry', ar: 'الطلب' }, s: { en: 'Send the programme, the dates and the party size to the commercial office.', ar: 'أرسلوا البرنامج والتواريخ وعدد الوفد إلى الإدارة التجارية' } },
      { t: { en: 'The offer', ar: 'العرض' }, s: { en: 'Availability comes back within one working day, with a written contracted rate sheet.', ar: 'يصلكم ردّ التوافر خلال يوم عمل، ومعه جدول أسعار تعاقدي مكتوب' } },
      { t: { en: 'The agreement', ar: 'الاتفاقية' }, s: { en: 'Rates, unit mix and meal arrangement are confirmed in writing and the allocation is held.', ar: 'تُعتمد الأسعار وتوزيع الوحدات وترتيب الوجبات كتابةً، ويُحجز التخصيص' } },
      { t: { en: 'The rooming list', ar: 'قائمة التسكين' }, s: { en: 'Reviewed and amended up to the agreed cut-off — names, pairings and special requests.', ar: 'تُراجَع وتُعدَّل حتى الموعد المتفق عليه — الأسماء والتوزيع والطلبات الخاصة' } },
      { t: { en: 'The event order', ar: 'أمر التشغيل' }, s: { en: 'One written plan circulated to reception, housekeeping, food &amp; beverage and accounts before the group lands.', ar: 'خطة واحدة مكتوبة تُعمَّم على الاستقبال والهاوسكيبينق والأغذية والمشروبات والحسابات قبل وصول المجموعة' } },
      { t: { en: 'Arrival and departure', ar: 'الوصول والمغادرة' }, s: { en: 'Group check-in handled as one movement, and one consolidated account settled on departure.', ar: 'تسجيل دخول جماعي يُنجَز كحركة واحدة، وتسوية حساب موحّدة عند المغادرة' } },
    ],
    promises: [{ en: 'NAMED CONTACT', ar: 'مسؤول باسمه' }, { en: 'WORKING DAY<br>TO REPLY', ar: 'يوم عمل للردّ' }, { en: 'WRITTEN EVENT<br>ORDER', ar: 'أمر تشغيل مكتوب' }],
    namedTitle: { en: 'ONE NAMED CONTACT', ar: 'مسؤول واحد باسمه' },
    named: {
      en: 'The same person answers the first enquiry, signs the agreement and stands behind the group on the day — <b>no hand-offs, no queue</b>.',
      ar: 'الشخص نفسه يردّ على أول استفسار، ويوقّع الاتفاقية، ويقف خلف المجموعة يوم التنفيذ — <b>بلا تحويلات ولا انتظار</b>',
    },
    disclaimer: {
      en: 'Armada Residence Hotels are located in Taif. This document makes no claim regarding registration on any pilgrimage platform, and none regarding accommodation inside Makkah Al-Mukarramah.',
      ar: 'فنادق أرمادا ريزيدنس تقع في الطائف. ولا يتضمّن هذا المستند أي ادّعاء بشأن التسجيل في أي منصة للحج والعمرة، ولا بشأن الإقامة داخل مكة المكرمة',
    },
  },

  meetings: {
    section: { en: 'Meetings & Events', ar: 'الاجتماعات والفعاليات' },
    h2: { en: 'An equipped hall, served from our own kitchen.', ar: 'قاعة مجهّزة، تُخدَم من مطبخنا.' },
    lead: {
      en: 'One equipped hall at Airport Road for up to {hall_capacity} people, arranged alongside the stay and served from our own kitchen — so the coffee break, the lunch and the room all sit on the same written plan and the same account.',
      ar: 'قاعة واحدة مجهّزة في طريق المطار تتسع حتى {hall_capacity} شخصاً، تُهيَّأ إلى جانب الإقامة وتُخدَم من مطبخنا — فيجتمع الكوفي بريك والغداء والتسكين على خطة واحدة مكتوبة وحساب واحد',
    },
    equipmentLabel: { en: 'EQUIPMENT', ar: 'التجهيزات' },
    seatingLabel: { en: 'SEATING STYLES — CAPACITY CONFIRMED ON ENQUIRY', ar: 'أنماط الجلوس — تُؤكَّد السعة لكل نمط عند الطلب' },
    seating: [{ en: 'Theatre', ar: 'مسرحي' }, { en: 'Classroom', ar: 'مدرسي' }, { en: 'U-shape', ar: 'U حرف' }, { en: 'Boardroom', ar: 'طاولة اجتماعات' }, { en: 'Rounds', ar: 'طاولات مستديرة' }],
    onRequest: { en: 'ON REQUEST', ar: 'عند الطلب' },
    hallCaption: { en: 'THE FUNCTION HALL — AIRPORT ROAD', ar: 'قاعة المناسبات — طريق المطار' },
    buffetCaption: { en: 'GROUP BUFFET', ar: 'بوفيه المجموعات' },
    cateringTitle: { en: 'CATERING IN THE HALL', ar: 'الضيافة داخل القاعة' },
    catering: [
      { en: '<b>Coffee break</b> — between sessions, inside the hall, from the hotel kitchen', ar: '<b>كوفي بريك</b> — بين الجلسات وداخل القاعة، من مطبخ الفندق' },
      { en: '<b>Lunch or dinner buffets</b> — in the hall or in the restaurant, by prior arrangement', ar: '<b>بوفيهات غداء أو عشاء</b> — داخل القاعة أو في المطعم، بالاتفاق المسبق' },
      { en: '<b>An executive chef</b> — Arabic, Asian and international menus, including Malaysian, Indonesian and Thai', ar: '<b>شيف تنفيذي</b> — قوائم عربية وآسيوية وعالمية، وتشمل الماليزية والإندونيسية والتايلاندية' },
      { en: '<b>One account</b> — hall, catering and rooms settled together', ar: '<b>حساب واحد</b> — القاعة والضيافة والتسكين تُسوَّى معاً' },
    ],
  },

  invite: {
    section: { en: 'An Invitation to Partner', ar: 'دعوة إلى الشراكة' },
    h2: { en: 'A partnership built once — and returning every season.', ar: 'شراكةٌ تُبنى مرّةً، وتُثمر كل موسم.' },
    sub: { en: 'We are not selling a night — we are building a relationship, and one agreement covers the whole season.', ar: 'نحن لا نبيع ليلة — بل نبني علاقة، واتفاقية واحدة تنظّم الموسم كاملاً' },
    rateTitle: { en: 'Special corporate &amp; travel-trade rates — to the end of the year', ar: 'أسعار وعروض خاصة للشركات ووكلاء السفر — حتى نهاية العام' },
    rateBody: {
      en: 'Send the dates and the party size; a contracted rate sheet comes back in writing — <b>held to the end of the year</b>.',
      ar: 'أرسلوا التواريخ وعدد الوفد، ويصلكم جدول أسعار تعاقدي مكتوب — <b>مثبّت حتى نهاية العام</b>',
    },
    rateTags: [{ en: 'CORPORATE RATES', ar: 'أسعار الشركات' }, { en: 'GROUP RATES', ar: 'أسعار المجموعات' }, { en: 'LONG STAY', ar: 'الإقامة الطويلة' }, { en: 'HALL &amp; COFFEE BREAK PACKAGES', ar: 'باقات القاعة والكوفي بريك' }, { en: 'CONSOLIDATED BILLING', ar: 'تسوية حساب موحّدة' }],
    getsLabel: { en: 'WHAT AN AGENT GETS', ar: 'ما يحصل عليه الوكيل' },
    gets: [
      { t: { en: 'Dedicated sales contact', ar: 'مسؤول مبيعات مخصَّص' }, s: { en: 'One named contact for your account, from enquiry to invoice.', ar: 'مسؤول واحد باسمه لحسابكم، من الاستفسار حتى الفاتورة' } },
      { t: { en: 'Availability within one working day', ar: 'ردّ التوافر خلال يوم عمل' }, s: { en: 'Decisions taken in-house, with no long approval chain.', ar: 'القرارات تُتَّخذ داخلياً بلا دورة اعتماد طويلة' } },
      { t: { en: 'Flexible rooming lists', ar: 'مرونة قوائم التسكين' }, s: { en: 'Reviewed and amended up to the agreed cut-off.', ar: 'تُراجَع وتُعدَّل حتى الموعد المتفق عليه' } },
      { t: { en: 'Group meal arrangements', ar: 'ترتيبات وجبات المجموعات' }, s: { en: 'Breakfast per guest; lunch and dinner by prior agreement.', ar: 'الإفطار للضيف؛ والغداء والعشاء بالاتفاق المسبق' } },
      { t: { en: 'Upgrades subject to availability', ar: 'ترقيات حسب التوافر' }, s: { en: 'For group leaders and VIP delegates.', ar: 'لقادة المجموعات وكبار الضيوف' } },
      { t: { en: 'Long stay solutions', ar: 'حلول الإقامة الطويلة' }, s: { en: 'Airport Road suites with kitchens.', ar: 'أجنحة طريق المطار المزوّدة بمطبخ' } },
    ],
  },

  office: {
    section: { en: 'The Commercial Office', ar: 'الإدارة التجارية' },
    eyebrow: { en: 'ISSUED BY', ar: 'صادر من' },
    h2: { en: 'The Commercial Office<br>Armada Residence Hotels', ar: 'الإدارة التجارية<br>فنادق أرمادا ريزيدنس' },
    sub: {
      en: 'Welcome to Armada Residence — send the programme, the dates and the party size, and availability comes back within one working day.',
      ar: 'أهلاً بكم في أرمادا ريزيدنس — أرسلوا البرنامج والتواريخ وعدد الوفد، ويصلكم الردّ خلال يوم عمل',
    },
    qr: [
      { t: { en: 'Airport Road', ar: 'طريق المطار' }, s: { en: 'LOCATION', ar: 'الموقع' } },
      { t: { en: 'Al Shafa Road', ar: 'طريق الشفا' }, s: { en: 'LOCATION', ar: 'الموقع' } },
      { t: { en: 'Follow us', ar: 'تابعونا' }, s: { en: 'LINKTR.EE/ARMADAR', ar: 'linktr.ee/ArmadaR' } },
    ],
    rows: [
      { en: 'MOBILE · WHATSAPP', ar: 'الجوال · واتساب' },
      { en: 'SALES &amp; MARKETING', ar: 'المبيعات والتسويق' },
      { en: 'RESERVATIONS', ar: 'الحجوزات' },
      { en: 'WEBSITE', ar: 'الموقع الإلكتروني' },
    ],
    disclaimer: {
      en: 'This fact sheet is issued by Armada Residence Hotels — Taif, for the travel trade. All information reflects the properties as recorded at the date of issue and is subject to change. Availability, unit allocation and hall use are subject to confirmation. No rates are quoted in this document; contract and group rates are issued separately by the commercial office on request.',
      ar: 'صدر ملف الحقائق هذا عن فنادق أرمادا ريزيدنس — الطائف، لقطاع السفر. تعكس المعلومات وضع الفندقين كما هو مسجّل بتاريخ الإصدار وهي قابلة للتحديث. يخضع التوافر وتخصيص الوحدات واستخدام القاعة للتأكيد. لا يتضمّن هذا المستند أي أسعار؛ إذ تصدر الأسعار التعاقدية وأسعار المجموعات عن الإدارة التجارية عند الطلب',
    },
  },
};
