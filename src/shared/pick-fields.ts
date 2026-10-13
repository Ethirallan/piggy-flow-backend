/**
 * The listed keys of a client body, and nothing else. Keys that are missing or
 * undefined are left out; a body that is not an object gives `{}`.
 */
export function pickFields<T, K extends keyof T>(source: unknown, keys: readonly K[]): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  if (source == null || typeof source !== 'object') return picked;
  for (const key of keys) {
    const value = (source as Partial<Pick<T, K>>)[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}
