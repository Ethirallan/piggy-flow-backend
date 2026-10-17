import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/trim.decorator.js';

/** The body for creating and renaming an account. */
export class AccountNameDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  name: string;
}
