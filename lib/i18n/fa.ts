import type { Messages } from './en';

/**
 * Persian (فارسی).
 *
 * Typed as `Messages`, so a key that goes missing here fails the build rather
 * than rendering blank. Two conventions worth stating, because both are easy
 * to get wrong from the outside:
 *
 * - Persian uses ZWNJ (U+200C) inside compound words — «می‌شود», not «می شود»
 *   and not «میشود». They are written literally here, not escaped, so the
 *   strings stay readable to a translator.
 * - Latin technical terms (API, PromptAmp, OpenRouter, Ollama, Alt+E) stay in
 *   Latin script. Transliterating a product name or a shortcut makes it
 *   unsearchable and unrecognisable.
 */

export const fa: Messages = {
  /* ── the injected button ──────────────────────────────────────── */
  'button.tooShort': 'اول چیزی بنویسید',
  'button.dismiss': 'پنهان کردن PromptAmp',

  /* ── dismissal menu ───────────────────────────────────────────── */
  'menu.hideUntilReload': 'پنهان تا بازدید بعدی',
  'menu.hideOnSite': 'پنهان کردن در این سایت',
  'menu.hideEverywhere': 'پنهان کردن در همه‌جا',
  'menu.settings': 'تنظیمات PromptAmp…',

  /* ── preview panel ────────────────────────────────────────────── */
  'panel.title': 'پرامپت بهینه‌شده',
  'panel.bodyAria': 'پرامپت بهینه‌شده، قابل ویرایش',
  'panel.close': 'بستن',
  'panel.changeProfile': 'تغییر پروفایل',
  'panel.prevVersion': 'نسخهٔ قبلی',
  'panel.nextVersion': 'نسخهٔ بعدی',
  'panel.busy': 'در حال بهینه‌سازی',
  'panel.ready': 'نسخهٔ بهینه‌شده آماده است',
  'panel.unchanged': 'متن شما همین حالا هم خوب است',
  'panel.accept': 'جایگزینی متن',
  'panel.copy': 'کپی',
  'panel.retry': 'تلاش دوباره',
  'panel.discard': 'لغو',
  'panel.showChanges': 'نمایش تغییرات',
  'panel.showOriginal': 'متن اصلی',
  'panel.adjustPlaceholder': 'چه تغییری می‌خواهید؟',
  'panel.adjustAria': 'چه تغییری می‌خواهید؟',
  'panel.adjustShorter': 'کوتاه‌تر',
  'panel.adjustLonger': 'بلندتر',
  'panel.adjustSpecific': 'دقیق‌تر',
  'panel.profileAuto': ' · خودکار',

  /* ── undo ─────────────────────────────────────────────────────── */
  'undo.replaced': 'متن جایگزین شد',
  'undo.action': 'بازگردانی',
  'undo.announce': 'متن جایگزین شد — برای برگرداندن، بازگردانی را بزنید.',

  /* ── errors ───────────────────────────────────────────────────── */
  'error.badKey': 'مشکل در کلید API',
  'error.badModel': 'مدل در دسترس نیست',
  'error.rateLimited': 'محدودیت نرخ درخواست',
  'error.quota': 'اعتبار تمام شده',
  'error.network': 'مشکل در اتصال',
  'error.refusal': 'مدل درخواست را رد کرد',
  'error.tooLong': 'متن خیلی بلند است',
  'error.softCap': 'به سقف روزانه رسیدید',
  'error.cancelled': 'لغو شد',
  'error.unknown': 'مشکلی پیش آمد',
  'error.draftSafe': 'متن شما دست‌نخورده باقی مانده است.',
  'error.retryIn': '{seconds} ثانیه تا تلاش دوباره',
  'error.fellBack': '{failed} ناموفق بود — به‌جای آن از {used} استفاده شد.',
  'error.noInsert':
    'ویرایشگر این سایت اجازهٔ درج مستقیم نمی‌دهد — متن را کپی کنید.',
  'error.copiedInstead':
    'ویرایشگر این سایت اجازهٔ درج مستقیم نمی‌دهد — متن کپی شد.',

  /* ── popup ────────────────────────────────────────────────────── */
  'popup.setup': 'برای شروع یک کلید API اضافه کنید',
  'popup.profileHere': 'پروفایل در این سایت',
  'popup.profileAria': 'پروفایل این سایت',
  'popup.profileAuto': 'خودکار',
  'popup.profilePinned': 'برای این سایت تثبیت شد.',
  'popup.profileUnpinned': 'بازگشت به حالت خودکار.',
  'popup.hideHere': 'پنهان کردن در این سایت',
  'popup.showHere': 'نمایش در این سایت',
  'popup.pauseHour': 'توقف یک‌ساعته در همهٔ سایت‌ها',
  'popup.resume': 'متوقف است — ادامه بده',
  'popup.hideEverywhere': 'پنهان کردن در همه‌جا',
  'popup.turnBackOn': 'روشن کردن دوبارهٔ PromptAmp',
  'popup.settings': 'تنظیمات…',
  'popup.notAvailable': 'در این صفحه در دسترس نیست',

  /* ── options: chrome ──────────────────────────────────────────── */
  'tab.providers': 'سرویس‌ها',
  'tab.profiles': 'پروفایل‌ها',
  'tab.behavior': 'رفتار',
  'tab.history': 'تاریخچه',
  'tab.about': 'درباره',
  'common.save': 'ذخیره',
  'common.saved': 'ذخیره شد',
  'common.saving': 'در حال ذخیره…',
  'common.remove': 'حذف',
  'common.delete': 'حذف',
  'common.edit': 'ویرایش',
  'common.back': 'بازگشت',
  'common.test': 'آزمایش',
  'common.testing': 'در حال آزمایش…',
  'common.loading': 'در حال بارگذاری…',
  'common.failed': 'ناموفق',
  'common.name': 'نام',
  'common.model': 'مدل',

  /* ── options: connections ─────────────────────────────────────── */
  'conn.heading': 'اتصال‌ها',
  'conn.chainOne':
    'یک اتصال دوم اضافه کنید تا هر وقت اتصال اول به محدودیت نرخ خورد، اعتبارش تمام شد یا در دسترس نبود، PromptAmp به‌طور خودکار سراغ آن برود.',
  'conn.chainMany':
    'PromptAmp از اتصال اول استفاده می‌کند. اگر به محدودیت نرخ بخورد، اعتبارش تمام شود، در دسترس نباشد یا کلیدش پذیرفته نشود، اتصال بعدی به‌طور خودکار جای آن را می‌گیرد و پنل به شما می‌گوید که جابه‌جایی انجام شده است.',
  'conn.sameProviderWarning':
    'بیش از یک اتصال به یک ارائه‌دهنده دارید. اگر این کلیدها واقعاً متعلق به خودتان باشند — یک کلید رایگان و یک کلید پولی، یا کاری و شخصی — اشکالی ندارد. اما بیشتر ارائه‌دهندگان ساختن حساب‌های رایگان اضافی برای دور زدن محدودیت‌ها را ممنوع کرده‌اند و جریمهٔ آن روی حساب شماست، پس شرایط استفادهٔ آن‌ها را بررسی کنید.',
  'conn.primary': 'اصلی',
  'conn.fallback': 'جایگزین {n}',
  'conn.connected': 'متصل',
  'conn.moveEarlier': 'انتقال {name} به جایگاه جلوتر در ترتیب جایگزینی',
  'conn.moveLater': 'انتقال {name} به جایگاه عقب‌تر در ترتیب جایگزینی',
  'conn.add': 'افزودن اتصال',
  'conn.addButton': 'افزودن اتصال',
  'conn.addHint':
    'هر اتصال یعنی یک کلید و یک مدل. هر تعداد که خواستید اضافه کنید — به همان ترتیب بالا اجرا می‌شوند.',
  'conn.addProvider': 'ارائه‌دهنده برای اتصال جدید',
  'conn.oauthHint': 'یا بدون واردکردن کلید، به OpenRouter وارد شوید:',
  'conn.oauthButton': 'اتصال با OpenRouter',
  'conn.oauthOpening': 'در حال بازکردن OpenRouter…',
  'conn.oauthDone': 'متصل شد',
  'conn.apiKey': 'کلید API',
  'conn.apiKeyOptional': 'کلید API (در صورت نیاز)',
  'conn.apiKeyPlaceholder': 'کلید API خود را اینجا بچسبانید',
  'conn.apiKeySaved': '•••••••• ذخیره شده',
  'conn.keyStorage':
    'فقط روی همین دستگاه ذخیره می‌شود و تنها worker پس‌زمینه می‌تواند آن را بخواند.',
  'conn.serverUrl': 'نشانی سرور',
  'conn.loadModels': 'بارگذاری مدل‌ها',
  'conn.modelsFound': '{n} مدل در دسترس است',
  'conn.modelsNone': 'مدلی پیدا نشد',
  'conn.working': 'سالم است — {model}',
  'conn.getKey': 'دریافت کلید {provider} ←',
  'conn.permissionTitle': '{provider} به اجازهٔ شما نیاز دارد',
  'conn.permissionBody':
    'مرورگر شما هنوز به PromptAmp اجازهٔ دسترسی به {host} را نداده است. تا وقتی اجازه ندهید، درخواست‌ها ناموفق می‌مانند، حتی اگر کلیدتان درست باشد.',
  'conn.permissionGrant': 'اجازهٔ دسترسی به {host}',
  'conn.permissionDenied':
    'ذخیره شد، اما مرورگر شما دسترسی به آن میزبان را رد کرد — تا زمانی که اجازه ندهید درخواست‌ها ناموفق خواهند بود.',

  /* ── options: profiles ────────────────────────────────────────── */
  'profiles.builtin': 'پروفایل‌های آماده',
  'profiles.builtinHint':
    'با هر به‌روزرسانی بهتر می‌شوند، برای همین قابل ویرایش نیستند. برای شخصی‌سازی، یک کپی از آن‌ها بسازید.',
  'profiles.mine': 'پروفایل‌های شما',
  'profiles.empty': 'هنوز پروفایل شخصی ندارید.',
  'profiles.fork': 'ساخت کپی',
  'profiles.copySuffix': '{name} (کپی)',
  'profiles.transfer': 'وارد کردن / خروجی گرفتن',
  'profiles.import': 'وارد کردن',
  'profiles.export': 'خروجی گرفتن از پروفایل‌ها',
  'profiles.importPlaceholder': 'محتوای فایل JSON را اینجا بچسبانید…',
  'profiles.imported': '{n} پروفایل وارد شد',
  'profiles.importBadJson': 'این متن JSON معتبری نیست.',
  'profiles.description': 'توضیح',
  'profiles.systemPrompt': 'پرامپت سیستمی',
  'profiles.editTitle': 'ویرایش {name}',
  'profiles.saveFailed': 'ذخیره نشد — نام و طول پرامپت را بررسی کنید.',

  /* ── options: behavior ────────────────────────────────────────── */
  'behavior.general': 'عمومی',
  'behavior.autoProfile': 'انتخاب خودکار پروفایل بر اساس سایت',
  'behavior.defaultProfile': 'پروفایل پیش‌فرض',
  'behavior.hideEverywhere': 'پنهان کردن PromptAmp در همه‌جا',
  'behavior.outputLanguage': 'زبان پرامپت بهبودیافته',
  'behavior.outputLanguagePlaceholder': 'همان زبان پیش‌نویس من',
  'behavior.outputLanguageHint':
    'پیش‌نویس را به هر زبانی بنویسید و پرامپت بهبودیافته را به این زبان بگیرید. اگر خالی بماند، زبان پیش‌نویس شما حفظ می‌شود — پرامپت‌های تصویر و ویدیو همچنان به انگلیسی نوشته می‌شوند، چون آن مدل‌ها با انگلیسی آموزش دیده‌اند.',
  'behavior.uiLanguage': 'زبان خود PromptAmp',
  'behavior.uiLanguageAuto': 'مثل زبان مرورگر',
  'behavior.limits': 'محدودیت‌ها',
  'behavior.dailyLimit': 'سقف روزانهٔ بهبود',
  'behavior.dailyLimitHint':
    'محافظی در برابر مصرف بی‌رویه از کلید خودتان. عدد ۰ آن را خاموش می‌کند.',
  'behavior.keepHistory': 'نگه‌داشتن تاریخچهٔ محلی بهبودها',
  'behavior.hiddenSites': 'سایت‌های پنهان‌شده',
  'behavior.hiddenNone': 'PromptAmp در هیچ سایتی پنهان نشده است.',
  'behavior.showAgain': 'نمایش دوباره',
  'behavior.shortcut': 'کلید میان‌بر',
  'behavior.shortcutHint':
    'کلید Alt+E فیلد فعال را بهبود می‌دهد. برای تغییر آن به chrome://extensions/shortcuts بروید.',

  /* ── options: history ─────────────────────────────────────────── */
  'history.local':
    'تاریخچه فقط روی همین دستگاه می‌ماند و هرگز جایی بارگذاری نمی‌شود.',
  'history.search': 'جست‌وجو در تاریخچه…',
  'history.export': 'خروجی گرفتن',
  'history.clear': 'پاک کردن تاریخچه',
  'history.empty': 'هنوز چیزی اینجا نیست.',
  'history.tokens': '{n} توکن',

  /* ── options: about ───────────────────────────────────────────── */
  'about.privacy': 'حریم خصوصی',
  'about.privacyBody':
    'PromptAmp هیچ سروری ندارد. پیش‌نویس‌های شما مستقیماً از مرورگرتان و با کلید خودتان به ارائه‌دهنده‌ای که انتخاب کرده‌اید می‌روند. هیچ داده‌ای جمع‌آوری نمی‌شود و هیچ‌گونه تحلیل رفتاری در کار نیست.',
  'about.keyBody':
    'کلید API شما در حافظهٔ محلی افزونه در همین مرورگر ذخیره می‌شود، هرگز همگام‌سازی نمی‌شود و تنها worker پس‌زمینه می‌تواند آن را بخواند — نه اسکریپتی که روی صفحه‌های وب اجرا می‌شود.',
  'about.historyBody':
    'تاریخچه روی همین دستگاه می‌ماند و هر زمان بخواهید می‌توانید آن را پاک کنید.',
  'about.openSource': 'متن‌باز',
  'about.mit': 'با مجوز MIT. هر خط کد را اینجا ببینید: ',
};
