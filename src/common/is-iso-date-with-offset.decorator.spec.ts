import { isIsoDateWithOffset } from './is-iso-date-with-offset.decorator.js';

describe('isIsoDateWithOffset', () => {
  it.each([
    '2026-10-16T11:26:00.000Z',
    '2026-10-16T13:26:00+02:00',
    '2026-10-16T13:26+02:00',
    '2026-10-16T11:26:00.5Z',
  ])('accepts %s', (value) => {
    expect(isIsoDateWithOffset(value)).toBe(true);
  });

  it.each([
    ['no offset (the v1 mobile format)', '2026-10-16T13:26:00.000'],
    ['a date only', '2026-10-16'],
    ['microseconds', '2026-10-16T11:26:00.123456Z'],
    ['an impossible day', '2026-02-30T10:00:00Z'],
    ['a space separator', '2026-10-16 11:26:00Z'],
    ['garbage', 'yesterday'],
    ['a number', 1760613960000],
  ])('rejects %s', (_case, value) => {
    expect(isIsoDateWithOffset(value)).toBe(false);
  });
});
