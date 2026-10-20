import { ApiProperty } from '@nestjs/swagger';
import {
  BillAccountDto,
  BillCategoryDto,
  BillShopDto,
  BillUserDto,
} from '../../bills/dto/bill-response.dto.js';
import { nextChargeDate } from '../charge-schedule.js';
import type { Subscription } from '../subscription.entity.js';

export class SubscriptionResponseDto {
  id: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  /** Whole cents charged every month. */
  priceCents: number;

  /** Day of the month, 1–31. */
  chargeDay: number;

  /** The next charge (YYYY-MM-DD, Ljubljana calendar). */
  @ApiProperty({ example: '2026-10-25' })
  nextChargeDate: string;

  account: BillAccountDto;

  @ApiProperty({ type: BillShopDto, nullable: true })
  shop: BillShopDto | null;

  @ApiProperty({ type: BillCategoryDto, nullable: true })
  category: BillCategoryDto | null;

  @ApiProperty({ type: BillUserDto, nullable: true })
  createdBy: BillUserDto | null;

  @ApiProperty({ type: BillUserDto, nullable: true })
  updatedBy: BillUserDto | null;

  createdAt: Date;
  updatedAt: Date;

  /** `subscription` must come from SubscriptionsService (relations loaded). */
  static from(subscription: Subscription): SubscriptionResponseDto {
    return {
      id: subscription.id,
      name: subscription.name,
      priceCents: subscription.priceCents,
      chargeDay: subscription.chargeDay,
      nextChargeDate: nextChargeDate(
        subscription.lastChargedMonth,
        subscription.chargeDay,
      ),
      account: {
        id: subscription.account!.id,
        name: subscription.account!.name,
      },
      shop: subscription.shop
        ? { id: subscription.shop.id, name: subscription.shop.name }
        : null,
      category: subscription.category
        ? {
            id: subscription.category.id,
            name: subscription.category.name,
            emoji: subscription.category.emoji,
          }
        : null,
      createdBy: BillUserDto.from(subscription.createdBy),
      updatedBy: BillUserDto.from(subscription.updatedBy),
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }
}
