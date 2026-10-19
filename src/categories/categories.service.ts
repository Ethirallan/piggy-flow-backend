import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service.js';
import { compareByName } from '../common/compare-by-name.js';
import { hasBills } from '../common/bill-usage.js';
import { isForeignKeyViolation } from '../common/db-errors.js';
import { rethrowListWriteError } from '../common/list-write-errors.js';
import { Category } from './category.entity.js';

export const CATEGORY_NAME_TAKEN = 'A category with that name already exists';
export const CATEGORY_IN_USE = 'Category is in use by bills';
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

  /** A filtered UPDATE, never save(): a category deleted meanwhile stays deleted (404). */
  async update(
    accountId: string,
    userId: string,
    id: string,
    changes: { name?: string; emoji?: string | null },
  ): Promise<Category> {
    if (changes.name === undefined && changes.emoji === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    await this.accounts.findForMember(accountId, userId);
    const set: { name?: string; emoji?: string | null } = {};
    if (changes.name !== undefined) set.name = changes.name;
    if (changes.emoji !== undefined) set.emoji = changes.emoji;
    let affected: number | undefined;
    try {
      ({ affected } = await this.categories.update({ id, accountId }, set));
    } catch (error) {
      rethrowListWriteError(error, CATEGORY_NAME_TAKEN);
    }
    const category = affected
      ? await this.categories.findOneBy({ id, accountId })
      : null;
    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    return category;
  }

  async delete(accountId: string, userId: string, id: string): Promise<void> {
    await this.accounts.findForMember(accountId, userId);
    if (
      await hasBills(this.categories.manager, accountId, {
        column: 'category_id',
        id,
      })
    ) {
      throw new ConflictException(CATEGORY_IN_USE);
    }
    // Subscriptions add their "still in use" check here. A bill saved after
    // the check trips the RESTRICT foreign key: the same 409.
    let affected: number | null | undefined;
    try {
      ({ affected } = await this.categories.delete({ id, accountId }));
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(CATEGORY_IN_USE);
      }
      throw error;
    }
    if (!affected) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
  }
}
