import { ApiHideProperty } from '@nestjs/swagger';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../accounts/account.entity.js';
import { Category } from '../categories/category.entity.js';
import { Shop } from '../shops/shop.entity.js';
import { Subscription } from '../subscriptions/subscription.entity.js';
import type { BillPhoto } from '../photos/bill-photo.entity.js';
import { User } from '../users/user.entity.js';

// Named so a violation's constraint tells which reference failed.
export const BILL_ACCOUNT_FK = 'FK_bills_account';
export const BILL_SHOP_FK = 'FK_bills_shop';
export const BILL_CATEGORY_FK = 'FK_bills_category';
export const BILL_SUBSCRIPTION_FK = 'FK_bills_subscription';
export const BILL_PRICE_CHECK = 'CHK_bills_price_cents_not_zero';

/** Money spent (or refunded, when negative) at a moment, owned by an account. */
@Entity('bills')
@Index('IDX_bills_account_date_id', ['accountId', 'date', 'id'])
@Check(BILL_PRICE_CHECK, '"price_cents" <> 0')
export class Bill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id', foreignKeyConstraintName: BILL_ACCOUNT_FK })
  account?: Account;

  @Column({ type: 'timestamptz' })
  date: Date;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents: number;

  @Index('IDX_bills_shop_id')
  @Column({ name: 'shop_id', type: 'uuid', nullable: true })
  shopId: string | null;

  @ManyToOne(() => Shop, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shop_id', foreignKeyConstraintName: BILL_SHOP_FK })
  shop?: Shop | null;

  @Index('IDX_bills_category_id')
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: BILL_CATEGORY_FK,
  })
  category?: Category | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  comment: string | null;

  /** The subscription that generated this bill; null for bills entered by hand. */
  @Index('IDX_bills_subscription_id')
  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @ManyToOne(() => Subscription, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'subscription_id',
    foreignKeyConstraintName: BILL_SUBSCRIPTION_FK,
  })
  subscription?: Subscription | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy?: User | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  updatedBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /**
   * Filled by BillsService (one query per page), not a TypeORM relation:
   * a decorated relation would make the two entity files import each other.
   */
  @ApiHideProperty() // else the Swagger plugin imports BillPhoto at runtime
  photos?: BillPhoto[];
}
