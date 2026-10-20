import { fixEmoji } from './fix-emoji.js';

describe('fixEmoji', () => {
  it.each([
    ['a valid emoji stays', '🍎', '🍎', false],
    ['a ZWJ sequence stays', '🧑‍🔧', '🧑‍🔧', false],
    ['a missing selector is added', '⚕', '⚕️', true],
    ['an extra selector is removed', '☕️', '☕', true],
    ['text is dropped', 'ab', null, true],
    ['empty is null', '', null, false],
    ['null stays null', null, null, false],
  ])('%s', (_case, input, emoji, changed) => {
    expect(fixEmoji(input)).toEqual({ emoji, changed });
  });
});
