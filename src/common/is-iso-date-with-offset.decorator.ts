import { isISO8601, ValidateBy, type ValidationOptions } from 'class-validator';

// Minutes required, seconds optional, at most milliseconds (JavaScript dates
// drop anything finer, which would break cursors), and an explicit offset.
const SHAPE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 moment that says which time zone it's in. */
export function isIsoDateWithOffset(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    SHAPE.test(value) &&
    isISO8601(value, { strict: true, strictSeparator: true })
  );
}

export function IsIsoDateWithOffset(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIsoDateWithOffset',
      validator: {
        validate: (value) => isIsoDateWithOffset(value),
        defaultMessage: () =>
          '$property must be an ISO 8601 date and time with an offset (Z or ±hh:mm)',
      },
    },
    options,
  );
}
