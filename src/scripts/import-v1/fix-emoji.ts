import { isSingleEmoji } from '../../common/is-single-emoji.decorator.js';

const SELECTOR = '️';

/** v2's single-emoji check, with v1 values repaired by adding or removing U+FE0F when that's enough. */
export function fixEmoji(emoji: string | null): { emoji: string | null; changed: boolean } {
  if (emoji === null || emoji === '') {
    return { emoji: null, changed: false };
  }
  if (isSingleEmoji(emoji)) {
    return { emoji, changed: false };
  }
  const repaired = emoji.includes(SELECTOR)
    ? emoji.replaceAll(SELECTOR, '')
    : `${emoji}${SELECTOR}`;
  return { emoji: isSingleEmoji(repaired) ? repaired : null, changed: true };
}
