import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { CodePointLength } from '../../common/code-point-length.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

export class CreateSubscriptionDto {
  @IsUUID()
  accountId: string;

  /** Whole cents charged every month (> 0). */
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  priceCents: number;

  /** Day of the month, 1–31; a day past a month's end charges on its last day. */
  @IsInt()
  @Min(1)
  @Max(31)
  chargeDay: number;

  /** Used as the generated bills' comment. */
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @CodePointLength(0, 100)
  name?: string | null;

  /** A shop of the same account. */
  @IsOptional()
  @IsUUID()
  shopId?: string | null;

  /** A category of the same account. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}
