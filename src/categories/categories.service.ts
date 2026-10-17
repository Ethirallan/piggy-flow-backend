import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service.js';
import { compareByName } from '../common/compare-by-name.js';
import { rethrowListWriteError } from '../common/list-write-errors.js';
import { Category } from './category.entity.js';

export const CATEGORY_NAME_TAKEN = 'A category with that name already exists';
export const CATEGORY_NOT_FOUND = 'Category not found';

export interface CategoryInput {
  name: string;
  emoji?: string | null;
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly accounts: AccountsService,
  ) {}

  /** The account's categories, by name ignoring case, then oldest first. */
  async list(accountId: string, userId: string): Promise<Category[]> {
    await this.accounts.findForMember(accountId, userId);
    const categories = await this.categories.findBy({ accountId });
    return categories.sort(compareByName);
  }

  async create(
    accountId: string,
    userId: string,
    input: CategoryInput,
  ): Promise<Category> {
    await this.accounts.findForMember(accountId, userId);
    try {
      return await this.categories.save(
        this.categories.create({
          accountId,
          name: input.name,
          emoji: input.emoji ?? null,
        }),
      );
    } catch (error) {
      rethrowListWriteError(error, CATEGORY_NAME_TAKEN);
    }
  }
}
