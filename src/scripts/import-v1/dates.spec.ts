import {
  cutCodePoints,
  readBillDate,
  toCents,
  wallTimeToInstant,
} from './dates.js';

describe('dates', () => {
  it('reads a wall time as UTC or as Ljubljana time (summer, winter, DST days)', () => {
    expect(wallTimeToInstant('2026-07-10 13:05:00', 'utc').toISOString()).toBe(
      '2026-07-10T13:05:00.000Z',
    );
    expect(
      wallTimeToInstant('2026-07-10 13:05:00', 'local').toISOString(),
    ).toBe('2026-07-10T11:05:00.000Z');
    expect(
      wallTimeToInstant('2026-01-10 13:05:00.250000', 'local').toISOString(),
    ).toBe('2026-01-10T12:05:00.250Z');
    // 29 March 2026 03:30 is after the spring-forward (UTC+2); 25 Oct 2026 03:30 after the fall-back (UTC+1).
    expect(
      wallTimeToInstant('2026-03-29 03:30:00', 'local').toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
    expect(
      wallTimeToInstant('2026-10-25 03:30:00', 'local').toISOString(),
    ).toBe('2026-10-25T02:30:00.000Z');
    // An hour before each change: the wall time read as UTC lands on the other side of it.
    expect(
      wallTimeToInstant('2026-03-29 01:30:00', 'local').toISOString(),
    ).toBe('2026-03-29T00:30:00.000Z');
    expect(
      wallTimeToInstant('2026-10-25 01:30:00', 'local').toISOString(),
    ).toBe('2026-10-24T23:30:00.000Z');
  });

  it.each([
    [
      'cron / web right away',
      '2025-03-04 06:00:02',
      '2025-03-04 06:00:02.123456',
      'same-as-created',
      '2025-03-04T06:00:02.000Z',
    ],
    [
      'mobile right away (winter, +1 h)',
      '2025-01-10 13:05:00',
      '2025-01-10 12:04:10.000000',
      'local-entry',
      '2025-01-10T12:05:00.000Z',
    ],
    [
      'mobile right away (summer, +2 h)',
      '2025-07-10 13:05:00',
      '2025-07-10 11:00:00.000000',
      'local-entry',
      '2025-07-10T11:05:00.000Z',
    ],
    [
      'entered later, before the web app',
      '2025-07-01 23:30:00',
      '2025-07-05 08:00:00.000000',
      'mobile-era',
      '2025-07-01T21:30:00.000Z',
    ],
    [
      'entered later, web era',
      '2026-10-01 23:30:00',
      '2026-10-05 08:00:00.000000',
      'web-era',
      '2026-10-01T23:30:00.000Z',
    ],
  ])('%s', (_case, date, created, rule, iso) => {
    const read = readBillDate(date, created);
    expect(read.rule).toBe(rule);
    expect(read.instant.toISOString()).toBe(iso);
  });

  it('marks a bill whose Ljubljana day depends on the reading', () => {
    // 23:30 read as UTC is 01:30 next day in Ljubljana; read as local it's the 1st.
    expect(
      readBillDate('2026-10-01 23:30:00', '2026-10-05 08:00:00.000000')
        .daysDiffer,
    ).toBe(true);
    expect(
      readBillDate('2026-10-01 12:00:00', '2026-10-05 08:00:00.000000')
        .daysDiffer,
    ).toBe(false);
  });

  it('uses the cutoff day on created', () => {
    expect(
      readBillDate('2026-09-20 12:00:00', '2026-09-26 23:59:59.999999').rule,
    ).toBe('mobile-era');
    expect(
      readBillDate('2026-09-20 12:00:00', '2026-09-27 00:00:00.000000').rule,
    ).toBe('web-era');
  });

  it.each([
    ['27.62', 2762],
    ['0.50', 50],
    ['5', 500],
    ['1685.07', 168507],
    ['-3.10', -310],
    ['9.9', 990],
    ['0.29', 29], // 0.29 * 100 is 28.999… in floating point
    ['19.99', 1999],
  ])('toCents(%s) is %i', (price, cents) => {
    expect(toCents(price)).toBe(cents);
  });

  it('rejects a price with more than two decimals or no digits', () => {
    expect(() => toCents('1.234')).toThrow('Invalid v1 price "1.234"');
    expect(() => toCents('abc')).toThrow();
  });

  it('rejects impossible dates and dates before 1970', () => {
    for (const wall of [
      '0000-00-00 00:00:00',
      '2025-02-30 10:00:00',
      '2025-13-01 10:00:00',
      '2025-01-01 24:00:00',
      '1969-12-31 23:59:59',
    ]) {
      expect(() => wallTimeToInstant(wall, 'utc')).toThrow(
        `invalid date "${wall}"`,
      );
    }
    expect(() =>
      readBillDate('2025-01-01 10:00:00', '2025-02-30 10:00:00.000000'),
    ).toThrow('invalid date "2025-02-30 10:00:00.000000"');
  });

  it('cuts by code points', () => {
    expect(cutCodePoints('a🧑‍🔧b', 2)).toBe('a\u{1F9D1}');
    expect(cutCodePoints('short', 100)).toBe('short');
  });
});
