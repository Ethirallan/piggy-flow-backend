import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';
import { IsSingleEmoji } from '../../common/is-single-emoji.decorator.js';
import { CodePointLength } from '../../common/code-point-length.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

/** Send at least one field; a field left out stays as it is. */
export class UpdateCategoryDto {
  /** Unique within the account, ignoring case. `null` is rejected. */
  // Not @IsOptional(): that would also let null through to a NOT NULL column.
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString()
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @CodePointLength(1, 100)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '🛒',
    description: 'Exactly one emoji; null clears it',
  })
  @IsOptional()
  @IsSingleEmoji()
  emoji?: string | null;
}
