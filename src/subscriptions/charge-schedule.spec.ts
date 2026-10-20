import {
  chargeDate,
  dueMonths,
  initialLastChargedMonth,
  lastChargedMonthAfterDayChange,
  localToday,
  monthOf,
  nextChargeDate,
} from './charge-schedule.js';

describe('charge schedule', () => {
  it.each([
    [2026, 2, 31, '2026-02-28'],
    [2028, 2, 31, '2028-02-29'],
    [2026, 4, 31, '2026-04-30'],
    [2026, 10, 31, '2026-10-31'],
    [2026, 10, 5, '2026-10-05'],
  ])('chargeDate(%i, %i, %i) is %s', (year, month, day, expected) => {
    expect(chargeDate(year, month, day)).toBe(expected);
  });

  it('gives the local calendar date in Ljubljana', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Ljubljana (UTC+1 in winter).
    expect(localToday(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(localToday(new Date('2026-07-10T21:59:00Z'))).toBe('2026-07-10');
  });

  it('gives the month of a date', () => {
    expect(monthOf('2026-10-20')).toBe('2026-10-01');
  });

  it.each([
    ['charges this month when the day is still ahead', 25, '2026-09-01'],
    ['charges today when today is the charge day', 20, '2026-09-01'],
    ['starts next month when the day has passed', 5, '2026-10-01'],
  ])('initialLastChargedMonth %s', (_case, day, expected) => {
    expect(initialLastChargedMonth(day, '2026-10-20')).toBe(expected);
  });

  it('lists every due month after the last charged one, up to today', () => {
    expect(dueMonths('2026-06-01', 15, '2026-10-20')).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
      '2026-10-15',
    ]);
    expect(dueMonths('2026-06-01', 25, '2026-10-20')).toEqual([
      '2026-07-25',
      '2026-08-25',
      '2026-09-25',
    ]);
    expect(dueMonths('2026-10-01', 15, '2026-10-20')).toEqual([]);
  });

  it('charges the 31st on the last day of short months, across a year boundary', () => {
    expect(dueMonths('2026-11-01', 31, '2027-03-01')).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('gives the next charge date', () => {
    expect(nextChargeDate('2026-09-01', 31)).toBe('2026-10-31');
    expect(nextChargeDate('2027-01-01', 30)).toBe('2027-02-28');
  });

  it.each([
    ['keeps an already charged month', '2026-10-01', 25, '2026-10-01'],
    [
      'starts next month when the new day has passed',
      '2026-09-01',
      5,
      '2026-10-01',
    ],
    [
      'charges this month when the new day is ahead',
      '2026-09-01',
      25,
      '2026-09-01',
    ],
    ['keeps missed earlier months due', '2026-06-01', 25, '2026-06-01'],
  ])('lastChargedMonthAfterDayChange %s', (_case, last, day, expected) => {
    expect(lastChargedMonthAfterDayChange(last, day, '2026-10-20')).toBe(
      expected,
    );
  });
});
