import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  In,
  IsNull,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
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
import { BillPhoto } from '../photos/bill-photo.entity.js';
import { PhotoStorage } from '../photos/photo-storage.js';
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
    @InjectRepository(BillPhoto)
    private readonly photos: Repository<BillPhoto>,
    private readonly storage: PhotoStorage,
    private readonly dataSource: DataSource,
  ) {}

  private readonly logger = new Logger(BillsService.name);

  /** The bill, if the caller is a member of its account; otherwise 404. One query. */
  async findForMember(id: string, userId: string): Promise<Bill> {
    const bill = await this.assertVisible(id, userId);
    await this.attachPhotos([bill]);
    return bill;
  }

  /** Like findForMember, for checks that only need access: no photo query. */
  async assertVisible(id: string, userId: string): Promise<Bill> {
    const bill = await this.visible(userId)
      .where('bill.id = :id', { id })
      .getOne();
    if (!bill) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }
    return bill;
  }

  /**
   * The bill, if the caller is a member of its account, with only the bill
   * row locked until `manager`'s transaction ends. Uploads take FOR NO KEY
   * UPDATE (they serialize with each other); deleting a bill takes FOR UPDATE.
   */
  async lockForMember(
    id: string,
    userId: string,
    manager: EntityManager,
    mode: 'for_no_key_update' | 'pessimistic_write' = 'for_no_key_update',
  ): Promise<Bill> {
    const bill = await manager
      .getRepository(Bill)
      .createQueryBuilder('bill')
      .innerJoin(
        AccountMember,
        'member',
        'member.accountId = bill.accountId AND member.userId = :userId',
        { userId },
      )
      .where('bill.id = :id', { id })
      .setLock(mode, undefined, ['bill'])
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
    const bill = await this.assertVisible(id, userId);
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
      // Filtered by what was read and checked: the account, and the shop and
      // category being kept. If any changed meanwhile (moved, deleted, or a
      // kept shop set elsewhere) nothing matches → 404, never a bill in one
      // account with another account's shop.
      ({ affected } = await this.bills.update(
        {
          id,
          accountId: bill.accountId,
          ...(changes.shopId === undefined && {
            shopId: bill.shopId ?? IsNull(),
          }),
          ...(changes.categoryId === undefined && {
            categoryId: bill.categoryId ?? IsNull(),
          }),
        },
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
    const photoIds = await this.dataSource.transaction(async (manager) => {
      // FOR UPDATE waits for an upload in progress, so its photos are seen here.
      const bill = await this.lockForMember(
        id,
        userId,
        manager,
        'pessimistic_write',
      );
      const photos = await manager.getRepository(BillPhoto).find({
        select: { id: true },
        where: { billId: bill.id },
      });
      await manager.getRepository(Bill).delete({ id: bill.id }); // rows cascade
      return photos.map((photo) => photo.id);
    });
    // After the commit: a failed delete only leaves an unreferenced file.
    for (const photoId of photoIds) {
      try {
        await this.storage.delete(photoId);
      } catch (error) {
        this.logger.warn({
          event: 'bills.photo_file_delete_failed',
          photoId,
          error: String(error),
        });
      }
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
      const items = await qb.getMany();
      await this.attachPhotos(items);
      return { items, nextCursor: null };
    }
    const limit = query.limit ?? BILL_PAGE_SIZE;
    // Every join is to-one, so a plain LIMIT counts bills. One extra row
    // tells whether another page follows.
    const rows = await qb.limit(limit + 1).getMany();
    const items = rows.slice(0, limit);
    await this.attachPhotos(items);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeBillCursor({ date: last.date, id: last.id })
          : null,
    };
  }

  /** One query for every bill's photos (never a join: it would multiply rows under LIMIT). */
  private async attachPhotos(bills: Bill[]): Promise<void> {
    if (bills.length === 0) {
      return;
    }
    const photos = await this.photos.find({
      where: { billId: In(bills.map((bill) => bill.id)) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const byBill = new Map<string, BillPhoto[]>();
    for (const photo of photos) {
      const list = byBill.get(photo.billId) ?? [];
      list.push(photo);
      byBill.set(photo.billId, list);
    }
    for (const bill of bills) {
      bill.photos = byBill.get(bill.id) ?? [];
    }
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
      .leftJoin('bill.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.displayName'])
      .leftJoin('bill.updatedBy', 'updatedBy')
      .addSelect(['updatedBy.id', 'updatedBy.displayName']);
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
