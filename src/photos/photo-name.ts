const CONTROL = /\p{Cc}/gu;
export const MAX_NAME_LENGTH = 255;

/** The uploaded file's name for display: no directories, no control characters, ≤ 255 code points. */
export function photoDisplayName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(CONTROL, '').trim();
  return [...clean].slice(0, MAX_NAME_LENGTH).join('') || 'photo';
}
