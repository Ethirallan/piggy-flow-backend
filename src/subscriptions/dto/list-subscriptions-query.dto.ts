import { IsOptional, IsUUID } from 'class-validator';

export class ListSubscriptionsQueryDto {
  /** Only this account's subscriptions. */
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
