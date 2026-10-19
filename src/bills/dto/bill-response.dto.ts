import { ApiProperty } from '@nestjs/swagger';
import { PhotoResponseDto } from '../../photos/dto/photo-response.dto.js';
import type { User } from '../../users/user.entity.js';
import type { Bill } from '../bill.entity.js';

export class BillAccountDto {
  id: string;
  name: string;
}

export class BillShopDto {
  id: string;
  name: string;
}

export class BillCategoryDto {
  id: string;
  name: string;

  @ApiProperty({ type: String, nullable: true, example: '🛒' })
  emoji: string | null;
}

export class BillUserDto {
  userId: string;
  displayName: string;

  static from(user: User | null | undefined): BillUserDto | null {
    return user ? { userId: user.id, displayName: user.displayName } : null;
  }
}

export class BillResponseDto {
  id: string;
  /** UTC. */
  date: Date;
  /** Whole cents; negative for a refund. */
  priceCents: number;

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  account: BillAccountDto;

  @ApiProperty({ type: BillShopDto, nullable: true })
  shop: BillShopDto | null;

  @ApiProperty({ type: BillCategoryDto, nullable: true })
  category: BillCategoryDto | null;

  /** Null once that user is deleted. */
  @ApiProperty({ type: BillUserDto, nullable: true })
  createdBy: BillUserDto | null;

  @ApiProperty({ type: BillUserDto, nullable: true })
  updatedBy: BillUserDto | null;

  createdAt: Date;
  updatedAt: Date;

  /** Oldest first. */
  @ApiProperty({ type: PhotoResponseDto, isArray: true })
  photos: PhotoResponseDto[];

  /** `bill` must come from BillsService (relations loaded). */
  static from(bill: Bill): BillResponseDto {
    return {
      id: bill.id,
      date: bill.date,
      priceCents: bill.priceCents,
      comment: bill.comment,
      account: { id: bill.account!.id, name: bill.account!.name },
      shop: bill.shop ? { id: bill.shop.id, name: bill.shop.name } : null,
      category: bill.category
        ? {
            id: bill.category.id,
            name: bill.category.name,
            emoji: bill.category.emoji,
          }
        : null,
      createdBy: BillUserDto.from(bill.createdBy),
      updatedBy: BillUserDto.from(bill.updatedBy),
      createdAt: bill.createdAt,
      updatedAt: bill.updatedAt,
      photos: (bill.photos ?? []).map((photo) => PhotoResponseDto.from(photo)),
    };
  }
}

export class BillPageDto {
  @ApiProperty({ type: BillResponseDto, isArray: true })
  items: BillResponseDto[];

  /** Pass as `cursor` for the next page; null on the last page and with `all`. */
  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
