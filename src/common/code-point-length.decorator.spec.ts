import { validateSync } from 'class-validator';
import {
  CodePointLength,
  codePointLength,
} from './code-point-length.decorator.js';

class Sample {
  @CodePointLength(1, 3)
  value: unknown;
}

const errorsFor = (value: unknown) =>
  validateSync(Object.assign(new Sample(), { value }));

describe('codePointLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['❤️', 2],
    ['👨‍👩‍👧', 5],
  ])('counts %j as %i', (value, expected) => {
    expect(codePointLength(value)).toBe(expected);
  });
});

describe('CodePointLength', () => {
  it.each(['a', 'abc', '❤️a', '😀😀😀'])('accepts %j', (value) => {
    expect(errorsFor(value)).toHaveLength(0);
  });

  it.each(['', 'abcd', '❤️❤️', '👨‍👩‍👧'])('rejects %j', (value) => {
    expect(errorsFor(value)).toHaveLength(1);
  });

  it.each([undefined, null, 12, ['a'], {}])(
    'rejects non-string %j',
    (value) => {
      expect(errorsFor(value)).toHaveLength(1);
    },
  );

  it('words the message with the limits', () => {
    expect(Object.values(errorsFor('')[0].constraints ?? {})).toEqual([
      'value must be between 1 and 3 characters',
    ]);
  });
});
