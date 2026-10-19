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

export const BILL_NOT_FOUND = 'Bill not found';
export const SHOP_NOT_IN_ACCOUNT = 'Shop is not in this account';
export const CATEGORY_NOT_IN_ACCOUNT = 'Category is not in this account';

export interface BillInput {
  accountId: string;
  date: Date;
  priceCents: number;
  shopId?: string | null;
  categoryId?: string | null;
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

  /** Bills of the accounts `userId` belongs to, with everything a response shows. */
  protected visible(userId: string): SelectQueryBuilder<Bill> {
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
  protected async assertInAccount(
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
