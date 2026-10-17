import { isSingleEmoji } from './is-single-emoji.decorator.js';

describe('isSingleEmoji', () => {
  it.each(['🛒', '🇸🇮', '👍🏽', '👨‍👩‍👧', '1️⃣', '❤️'])('accepts %s', (value) => {
    expect(isSingleEmoji(value)).toBe(true);
  });

  it.each([
    ['two emojis', '🛒🛒'],
    ['text', 'food'],
    ['an emoji with text', '🛒 food'],
    ['a plain digit', '1'],
    ['a bare heart without the emoji variation selector', '❤'],
    ['an empty string', ''],
    ['a number', 5],
    ['null', null],
  ])('rejects %s', (_case, value) => {
    expect(isSingleEmoji(value)).toBe(false);
  });
});
