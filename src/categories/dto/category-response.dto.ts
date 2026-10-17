import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '../category.entity.js';

export class CategoryResponseDto {
  id: string;
  accountId: string;
  name: string;

  @ApiProperty({ type: String, nullable: true, example: '🛒' })
  emoji: string | null;

  createdAt: Date;
  updatedAt: Date;

  static from(category: Category): CategoryResponseDto {
    return {
      id: category.id,
      accountId: category.accountId,
      name: category.name,
      emoji: category.emoji,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
