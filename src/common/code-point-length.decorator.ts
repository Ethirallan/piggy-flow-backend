import { ValidateBy, type ValidationOptions } from 'class-validator';

/** Length in Unicode code points, which is what Postgres counts for varchar(n). */
export function codePointLength(value: string): number {
  // Spreading a string yields code points, which is exactly the count wanted.
  // oxlint-disable-next-line typescript/no-misused-spread
  return [...value].length;
}

/**
 * Between `min` and `max` code points. class-validator's `@Length` skips
 * characters such as U+FE0F, so a value it accepts can still be too long for
 * the column (Postgres 22001 → 500).
 */
export function CodePointLength(
  min: number,
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'codePointLength',
      constraints: [min, max],
      validator: {
        validate: (value) => {
          if (typeof value !== 'string') return false;
          const length = codePointLength(value);
          return length >= min && length <= max;
        },
        defaultMessage: () =>
          `$property must be between ${min} and ${max} characters`,
      },
    },
    options,
  );
}
