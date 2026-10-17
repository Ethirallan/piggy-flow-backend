import { IsEmail, MaxLength } from 'class-validator';
import { Trim } from '../../common/trim.decorator.js';

export class AddMemberDto {
  /** Matched case-insensitively against registered users. */
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email: string;
}
