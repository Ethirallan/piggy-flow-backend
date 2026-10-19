import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type SelectQueryBuilder } from 'typeorm';
import { AccountMember } from '../accounts/account-member.entity.js';
import {
  ACCOUNT_NOT_FOUND,
  AccountsService,
} from '../accounts/accounts.service.js';
import { Category } from '../categories/category.entity.js';
import {
  isForeignKeyViolation,
  violatedConstraint,
} from '../common/db-errors.js';
import { Shop } from '../shops/shop.entity.js';
import {
  Bill,
  BILL_ACCOUNT_FK,
  BILL_CATEGORY_FK,
  BILL_SHOP_FK,
} from './bill.entity.js';
import { decodeBillCursor, encodeBillCursor } from './bill-cursor.js';

export const BILL_NOT_FOUND = 'Bill not found';
export const SHOP_NOT_IN_ACCOUNT = 'Shop is not in this account';
export const CATEGORY_NOT_IN_ACCOUNT = 'Category is not in this account';

export const BILL_PAGE_SIZE = 50;
export const BILL_PAGE_MAX = 100;

export interface BillListQuery {
  accountId?: string;
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
  limit?: number;
  cursor?: string;
  /** The whole filtered range in one page. */
  all?: boolean;
}

export interface BillPage {
  items: Bill[];
  nextCursor: string | null;
}

export interface BillInput {
  accountId: string;
  date: Date;
  priceCents: number;
  shopId?: string | null;
  categoryId?: string | null;
  comment?: string | null;
}

export interface BillChanges {
  accountId?: string;
  date?: Date;
  priceCents?: number;
  /** null clears it. */
  shopId?: string | null;
  /** null clears it. */
  categoryId?: string | null;
  /** null clears it. */
  comment?: string | null;
}

@Injectable()
export class BillsService {
  constructor(
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
    private readonly accounts: AccountsService,
    private readonly dataSource: DataSource,
  ) {}

  /** The bill, if the caller is a member of its account; otherwise 404. One query. */
  async findForMember(id: string, userId: string): Promise<Bill> {
    const bill = await this.visible(userId)
      .where('bill.id = :id', { id })
      .getOne();
    if (!bill) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }
    return bill;
  }

  async create(userId: string, input: BillInput): Promise<Bill> {
    await this.accounts.findForMember(input.accountId, userId);
    const shopId = input.shopId ?? null;
    const categoryId = input.categoryId ?? null;
    await this.assertInAccount(input.accountId, shopId, categoryId);
    let id: string;
    try {
      ({ id } = await this.bills.save(
        this.bills.create({
          accountId: input.accountId,
          date: input.date,
          priceCents: input.priceCents,
          shopId,
          categoryId,
          comment: normalizeComment(input.comment),
          createdById: userId,
          updatedById: userId,
        }),
      ));
    } catch (error) {
      rethrowBillWriteError(error);
    }
    return this.findForMember(id, userId);
  }

  /**
   * Changes only the fields given. Moving to another account needs
   * membership there, and the bill's shop and category (new or kept) must
   * belong to the account it ends up in. A filtered UPDATE, never save().
   */
  async update(
    userId: string,
    id: string,
    changes: BillChanges,
  ): Promise<Bill> {
    if (Object.values(changes).every((value) => value === undefined)) {
      throw new BadRequestException('Nothing to update');
    }
    const bill = await this.findForMember(id, userId);
    const accountId = changes.accountId ?? bill.accountId;
    if (accountId !== bill.accountId) {
      await this.accounts.findForMember(accountId, userId);
    }
    const shopId = changes.shopId !== undefined ? changes.shopId : bill.shopId;
    const categoryId =
      changes.categoryId !== undefined ? changes.categoryId : bill.categoryId;
    await this.assertInAccount(accountId, shopId, categoryId);

    const set: Partial<
      Pick<
        Bill,
        | 'accountId'
        | 'date'
        | 'priceCents'
        | 'shopId'
        | 'categoryId'
        | 'comment'
        | 'updatedById'
      >
    > = { updatedById: userId };
    if (changes.accountId !== undefined) set.accountId = changes.accountId;
    if (changes.date !== undefined) set.date = changes.date;
    if (changes.priceCents !== undefined) set.priceCents = changes.priceCents;
    if (changes.shopId !== undefined) set.shopId = changes.shopId;
    if (changes.categoryId !== undefined) set.categoryId = changes.categoryId;
    if (changes.comment !== undefined) {
      set.comment = normalizeComment(changes.comment);
    }

    let affected: number | null | undefined;
    try {
      // Filtered by the account it was read in: moved or deleted meanwhile → 404.
      ({ affected } = await this.bills.update(
        { id, accountId: bill.accountId },
        set,
      ));
    } catch (error) {
      rethrowBillWriteError(error);
    }
    if (!affected) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }
    return this.findForMember(id, userId);
  }

  async delete(userId: string, id: string): Promise<void> {
    const bill = await this.findForMember(id, userId);
    // The photos spec adds file cleanup here.
    const { affected } = await this.bills.delete({
      id,
      accountId: bill.accountId,
    });
    if (!affected) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }
  }

  /** Newest first (date, then id), filtered; a page, or everything with `all`. */
  async list(userId: string, query: BillListQuery): Promise<BillPage> {
    if (query.all && query.cursor !== undefined) {
      throw new BadRequestException("cursor can't be combined with all");
    }
    if (query.from && query.to && query.from >= query.to) {
      throw new BadRequestException('from must be before to');
    }
    const cursor =
      query.cursor === undefined ? undefined : decodeBillCursor(query.cursor);
    if (cursor === null) {
      throw new BadRequestException('Invalid cursor');
    }
    if (query.accountId !== undefined) {
      await this.accounts.findForMember(query.accountId, userId);
    }

    const qb = this.visible(userId);
    if (query.accountId !== undefined) {
      qb.andWhere('bill.accountId = :accountId', {
        accountId: query.accountId,
      });
    }
    if (query.from) {
      qb.andWhere('bill.date >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('bill.date < :to', { to: query.to });
    }
    if (cursor) {
      qb.andWhere('(bill.date, bill.id) < (:cursorDate, :cursorId)', {
        cursorDate: cursor.date,
        cursorId: cursor.id,
      });
    }
    qb.orderBy('bill.date', 'DESC').addOrderBy('bill.id', 'DESC');

    if (query.all) {
      return { items: await qb.getMany(), nextCursor: null };
    }
    const limit = query.limit ?? BILL_PAGE_SIZE;
    // Every join is to-one, so a plain LIMIT counts bills. One extra row
    // tells whether another page follows.
    const rows = await qb.limit(limit + 1).getMany();
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeBillCursor({ date: last.date, id: last.id })
          : null,
    };
  }

  /** Bills of the accounts `userId` belongs to, with everything a response shows. */
  private visible(userId: string): SelectQueryBuilder<Bill> {
    return this.bills
      .createQueryBuilder('bill')
      .innerJoin(
        AccountMember,
        'member',
        'member.accountId = bill.accountId AND member.userId = :userId',
        { userId },
      )
      .leftJoinAndSelect('bill.account', 'account')
      .leftJoinAndSelect('bill.shop', 'shop')
      .leftJoinAndSelect('bill.category', 'category')
      .leftJoinAndSelect('bill.createdBy', 'createdBy')
      .leftJoinAndSelect('bill.updatedBy', 'updatedBy');
  }

  /** 400 unless the shop and category (when set) belong to the account. */
  private async assertInAccount(
    accountId: string,
    shopId: string | null,
    categoryId: string | null,
  ): Promise<void> {
    if (
      shopId !== null &&
      !(await this.dataSource
        .getRepository(Shop)
        .existsBy({ id: shopId, accountId }))
    ) {
      throw new BadRequestException(SHOP_NOT_IN_ACCOUNT);
    }
    if (
      categoryId !== null &&
      !(await this.dataSource
        .getRepository(Category)
        .existsBy({ id: categoryId, accountId }))
    ) {
      throw new BadRequestException(CATEGORY_NOT_IN_ACCOUNT);
    }
  }
}

/** Trimmed; blank is null. */
export function normalizeComment(
  comment: string | null | undefined,
): string | null {
  const trimmed = comment?.trim();
  return trimmed ? trimmed : null;
}

/**
 * A reference deleted after it was checked: the account (404, as if the
 * caller had never been a member) or the shop / category (400).
 */
export function rethrowBillWriteError(error: unknown): never {
  if (isForeignKeyViolation(error)) {
    switch (violatedConstraint(error)) {
      case BILL_ACCOUNT_FK:
        throw new NotFoundException(ACCOUNT_NOT_FOUND);
      case BILL_SHOP_FK:
        throw new BadRequestException(SHOP_NOT_IN_ACCOUNT);
      case BILL_CATEGORY_FK:
        throw new BadRequestException(CATEGORY_NOT_IN_ACCOUNT);
    }
  }
  throw error;
}
