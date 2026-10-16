import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../common/trim.decorator.js';

export class RegisterDto {
  /** Stored trimmed and lowercased. */
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @Trim()
  @IsString()
  @Length(1, 100)
  displayName: string;
}
