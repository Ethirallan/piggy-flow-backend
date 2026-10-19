import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateIf,
} from 'class-validator';
import { IsIsoDateWithOffset } from '../../common/is-iso-date-with-offset.decorator.js';
import { Trim } from '../../common/trim.decorator.js';

const isSent = (_object: object, value: unknown) => value !== undefined;

/** Send at least one field; a field left out stays as it is. */
export class UpdateBillDto {
  /** Moves the bill. Its shop and category must exist in that account. Not null. */
  // Not @IsOptional(): that would let null through to a NOT NULL column.
  @ValidateIf(isSent)
  @IsUUID()
  accountId?: string;

  /** ISO 8601 with an offset. Not null. */
  @ValidateIf(isSent)
  @IsIsoDateWithOffset()
  date?: string;

  /** Whole cents; negative for a refund, never 0. Not null. */
  @ValidateIf(isSent)
  @IsInt()
  @NotEquals(0)
  @Min(-2_147_483_647)
  @Max(2_147_483_647)
  priceCents?: number;

  /** null clears it. */
  @IsOptional()
  @IsUUID()
  shopId?: string | null;

  /** null clears it. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  /** null clears it. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}
