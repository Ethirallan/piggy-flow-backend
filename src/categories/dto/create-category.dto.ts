import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { IsSingleEmoji } from '../../common/is-single-emoji.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

export class CreateCategoryDto {
  /** Unique within the account, ignoring case. */
  @Trim()
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '🛒',
    description: 'Exactly one emoji',
  })
  @IsOptional()
  @IsSingleEmoji()
  emoji?: string | null;
}
