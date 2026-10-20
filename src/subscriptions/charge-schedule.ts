/** Charge days and "today" follow this calendar. */
export const CHARGE_TIME_ZONE = 'Europe/Ljubljana';

interface YearMonth {
  year: number;
  /** 1–12. */
  month: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

function parse(date: string): YearMonth {
  const [year, month] = date.split('-').map(Number);
  return { year, month };
}

function addMonths({ year, month }: YearMonth, count: number): YearMonth {
  const index = year * 12 + (month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function firstDay({ year, month }: YearMonth): string {
  return `${year}-${pad(month)}-01`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today's date (YYYY-MM-DD) in Ljubljana. */
export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHARGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The first day of the date's month. */
export function monthOf(date: string): string {
  return firstDay(parse(date));
}

/** A month's charge date: the charge day, or the month's last day when it's shorter. */
export function chargeDate(
  year: number,
  month: number,
  chargeDay: number,
): string {
  return `${year}-${pad(month)}-${pad(Math.min(chargeDay, daysInMonth(year, month)))}`;
}

/** Charge dates of every month after `lastChargedMonth` that are on or before `today`. */
export function dueMonths(
  lastChargedMonth: string,
  chargeDay: number,
  today: string,
): string[] {
  const due: string[] = [];
  for (let month = addMonths(parse(lastChargedMonth), 1); ;) {
    const date = chargeDate(month.year, month.month, chargeDay);
    if (date > today) {
      return due;
    }
    due.push(date);
    month = addMonths(month, 1);
  }
}

/** For a new subscription: charge this month if its day is today or ahead, else start next month. */
export function initialLastChargedMonth(
  chargeDay: number,
  today: string,
): string {
  const current = parse(today);
  return chargeDate(current.year, current.month, chargeDay) >= today
    ? firstDay(addMonths(current, -1))
    : firstDay(current);
}

/**
 * After the charge day changes: an already charged month stays charged (the
 * new day applies from next month); if the new day has passed this month,
 * the first charge is next month; otherwise nothing changes, so months missed
 * during downtime stay due.
 */
export function lastChargedMonthAfterDayChange(
  lastChargedMonth: string,
  newChargeDay: number,
  today: string,
): string {
  const current = parse(today);
  const thisMonth = firstDay(current);
  if (lastChargedMonth >= thisMonth) {
    return lastChargedMonth;
  }
  return chargeDate(current.year, current.month, newChargeDay) < today
    ? thisMonth
    : lastChargedMonth;
}

/** The charge date of the first month not charged yet. */
export function nextChargeDate(
  lastChargedMonth: string,
  chargeDay: number,
): string {
  const next = addMonths(parse(lastChargedMonth), 1);
  return chargeDate(next.year, next.month, chargeDay);
}
