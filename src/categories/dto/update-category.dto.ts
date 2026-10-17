import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { IsSingleEmoji } from '../../common/is-single-emoji.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

/** Send at least one field; a field left out stays as it is. */
export class UpdateCategoryDto {
  /** Unique within the account, ignoring case. `null` is rejected. */
  // Not @IsOptional(): that would also let null through to a NOT NULL column.
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString()
  @Length(1, 100)
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
