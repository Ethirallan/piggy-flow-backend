import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/trim.decorator.js';

/** The body for creating and renaming a shop. */
export class ShopNameDto {
  /** Unique within the account, ignoring case. */
  @Trim()
  @IsString()
  @Length(1, 100)
  name: string;
}
