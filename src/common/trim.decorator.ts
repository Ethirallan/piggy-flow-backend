import { Transform } from 'class-transformer';

/** Trims string input before validation; leaves other types for the validators to reject. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
