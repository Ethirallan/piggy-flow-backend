import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { CodePointLength } from '../../common/code-point-length.decorator.js';
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
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @CodePointLength(1, 100)
  displayName: string;
}
