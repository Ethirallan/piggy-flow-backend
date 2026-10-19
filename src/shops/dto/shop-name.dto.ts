import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CodePointLength } from '../../common/code-point-length.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

/** The body for creating and renaming a shop. */
export class ShopNameDto {
  /** Unique within the account, ignoring case. */
  @Trim()
  @IsString()
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @CodePointLength(1, 100)
  name: string;
}
