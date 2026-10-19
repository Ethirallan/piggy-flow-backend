import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { IsIsoDateWithOffset } from '../../common/is-iso-date-with-offset.decorator.js';
import { BILL_PAGE_MAX } from '../bills.service.js';

export class ListBillsQueryDto {
  /** Only this account's bills. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** Inclusive, ISO 8601 with an offset. */
  @IsOptional()
  @IsIsoDateWithOffset()
  from?: string;

  /** Exclusive, ISO 8601 with an offset. */
  @IsOptional()
  @IsIsoDateWithOffset()
  to?: string;

  /** Page size, 1–100 (default 50). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BILL_PAGE_MAX)
  limit?: number;

  /** The previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** `true` returns the whole filtered range in one page. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  all?: boolean;
}
