import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  NotEquals,
} from 'class-validator';
import { IsIsoDateWithOffset } from '../../common/is-iso-date-with-offset.decorator.js';
import { CodePointLength } from '../../common/code-point-length.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

export class CreateBillDto {
  @IsUUID()
  accountId: string;

  /** When it was paid: ISO 8601 with an offset, e.g. `2026-10-16T13:26:00+02:00`. */
  @IsIsoDateWithOffset()
  date: string;

  /** Whole cents; negative for a refund, never 0. */
  @IsInt()
  @NotEquals(0)
  @Min(-2_147_483_647)
  @Max(2_147_483_647)
  priceCents: number;

  /** A shop of the same account. */
  @IsOptional()
  @IsUUID()
  shopId?: string | null;

  /** A category of the same account. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @ApiPropertyOptional({ minLength: 0, maxLength: 1000 })
  @CodePointLength(0, 1000)
  comment?: string | null;
}
