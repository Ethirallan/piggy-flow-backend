import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
const emojiRegex = require('emoji-regex');

export function IsSingleEmoji(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'IsSingleEmoji',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const regex = emojiRegex();
          const match = value.match(regex);
          return match && match.length === 1;
        },
        defaultMessage(args: ValidationArguments) {
          return 'Emoji is invalid or more than one emoji is provided';
        }
      }
    });
  };
}