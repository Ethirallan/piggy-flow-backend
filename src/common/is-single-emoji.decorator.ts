import { ValidateBy, type ValidationOptions } from 'class-validator';

// Built with the constructor: the build targets ES2023, and TypeScript rejects
// a v-flag regex literal below ES2024. Node supports the flag at runtime.
const SINGLE_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');

/** Exactly one emoji, including flags, skin tones, keycaps and ZWJ sequences. */
export function isSingleEmoji(value: unknown): boolean {
  return typeof value === 'string' && SINGLE_EMOJI.test(value);
}

export function IsSingleEmoji(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSingleEmoji',
      validator: {
        validate: (value) => isSingleEmoji(value),
        defaultMessage: () => '$property must be exactly one emoji',
      },
    },
    options,
  );
}
