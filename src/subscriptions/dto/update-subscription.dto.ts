import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { CodePointLength } from '../../common/code-point-length.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

const isSent = (_object: object, value: unknown) => value !== undefined;

/** Send at least one field; a field left out stays as it is. */
export class UpdateSubscriptionDto {
  /** Moves the subscription. Its shop and category must exist in that account. Not null. */
  // Not @IsOptional(): that would let null through to a NOT NULL column.
  @ValidateIf(isSent)
  @IsUUID()
  accountId?: string;

  /** Whole cents charged every month (> 0). Not null. */
  @ValidateIf(isSent)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  priceCents?: number;

  /** Day of the month, 1–31. Not null. */
  @ValidateIf(isSent)
  @IsInt()
  @Min(1)
  @Max(31)
  chargeDay?: number;

  /** null clears it. */
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @CodePointLength(0, 100)
  name?: string | null;

  /** null clears it. */
  @IsOptional()
  @IsUUID()
  shopId?: string | null;

  /** null clears it. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}
