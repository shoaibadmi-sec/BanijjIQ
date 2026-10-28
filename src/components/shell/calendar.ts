export const HIJRI_BANGLADESH_DAY_ADJUSTMENT = -2;

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BANGLA_MONTHS = [
  'বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন',
  'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'
];
const HIJRI_MONTHS_BN = [
  'মহরম',
  'সফর',
  'রবিউল আউয়াল',
  'রবিউস সানি',
  'জমাদিউল আউয়াল',
  'জমাদিউস সানি',
  'রজব',
  'শাবান',
  'রমজান',
  'শাওয়াল',
  'জিলকদ',
  'জিলহজ'
];

export interface IslamicCivilDate {
  day: number;
  month: number;
  year: number;
}

export interface SherErpCalendarDates {
  english: string;
  bangla: string;
  hijri: string;
}

export function toBanglaDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, digit => BANGLA_DIGITS[Number(digit)]);
}

export function formatEnglishDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function formatBanglaDate(date: Date): string {
  // Bangladesh civil Bangla calendar used by the original Apps Script ERP.
  let gregorianYear = date.getFullYear();
  let start = new Date(gregorianYear, 3, 14);
  let banglaYear = gregorianYear - 593;
  const currentDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let diff = Math.floor((currentDay.getTime() - start.getTime()) / 86_400_000);

  if (diff < 0) {
    gregorianYear -= 1;
    start = new Date(gregorianYear, 3, 14);
    banglaYear = gregorianYear - 593;
    diff = Math.floor((currentDay.getTime() - start.getTime()) / 86_400_000);
  }

  const monthLengths = [
    31, 31, 31, 31, 31,
    30, 30, 30, 30, 30,
    isGregorianLeapYear(gregorianYear + 1) ? 31 : 30,
    30
  ];

  let monthIndex = 0;
  while (monthIndex < monthLengths.length - 1 && diff >= monthLengths[monthIndex]) {
    diff -= monthLengths[monthIndex];
    monthIndex += 1;
  }

  return `${toBanglaDigits(diff + 1)} ${BANGLA_MONTHS[monthIndex]} ${toBanglaDigits(banglaYear)}`;
}

export function gregorianToIslamicCivil(date: Date): IslamicCivilDate {
  // Deterministic fallback retained from the Apps Script version for browsers
  // or Android WebViews with incomplete Intl Islamic-calendar support.
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const a = Math.floor((14 - month) / 12);
  const yy = year + 4800 - a;
  const mm = month + 12 * a - 3;
  const julianDay = day + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;

  let l = julianDay - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719)
    + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50)
    - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const islamicMonth = Math.floor((24 * l) / 709);
  const islamicDay = l - Math.floor((709 * islamicMonth) / 24);
  const islamicYear = 30 * n + j - 30;

  return { day: islamicDay, month: islamicMonth, year: islamicYear };
}

export function formatHijriDate(date: Date): string {
  const observedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  observedDate.setDate(observedDate.getDate() + HIJRI_BANGLADESH_DAY_ADJUSTMENT);

  try {
    // Request numeric parts only. Some Android WebViews can return a Gregorian
    // English month name when an Islamic long month is requested.
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-islamic-nu-latn', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric'
    });
    const calendar = String(formatter.resolvedOptions?.().calendar ?? '').toLowerCase();

    if (!calendar || calendar.startsWith('islamic')) {
      const parts = formatter.formatToParts(observedDate);
      const day = Number.parseInt(parts.find(part => part.type === 'day')?.value ?? '', 10);
      const month = Number.parseInt(parts.find(part => part.type === 'month')?.value ?? '', 10);
      const year = Number.parseInt(parts.find(part => part.type === 'year')?.value ?? '', 10);

      if (Number.isFinite(day) && Number.isFinite(month) && month >= 1 && month <= 12 && Number.isFinite(year)) {
        return `${toBanglaDigits(day)} ${HIJRI_MONTHS_BN[month - 1]} ${toBanglaDigits(year)}`;
      }
    }
  } catch {
    // Fall through to deterministic civil conversion.
  }

  const fallback = gregorianToIslamicCivil(observedDate);
  return `${toBanglaDigits(fallback.day)} ${HIJRI_MONTHS_BN[fallback.month - 1]} ${toBanglaDigits(fallback.year)}`;
}

export function getSherErpCalendarDates(date = new Date()): SherErpCalendarDates {
  return {
    english: formatEnglishDate(date),
    bangla: formatBanglaDate(date),
    hijri: formatHijriDate(date)
  };
}
