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
import { User } from '../users/user.entity.js';

export const SUBSCRIPTION_ACCOUNT_FK = 'FK_subscriptions_account';
export const SUBSCRIPTION_SHOP_FK = 'FK_subscriptions_shop';
export const SUBSCRIPTION_CATEGORY_FK = 'FK_subscriptions_category';
export const SUBSCRIPTION_PRICE_CHECK =
  'CHK_subscriptions_price_cents_positive';
export const SUBSCRIPTION_CHARGE_DAY_CHECK = 'CHK_subscriptions_charge_day';
export const SUBSCRIPTION_MONTH_CHECK = 'CHK_subscriptions_last_charged_month';

/** A monthly charge that becomes one bill per month on its charge day. */
@Entity('subscriptions')
@Check(SUBSCRIPTION_PRICE_CHECK, '"price_cents" > 0')
@Check(SUBSCRIPTION_CHARGE_DAY_CHECK, '"charge_day" BETWEEN 1 AND 31')
@Check(SUBSCRIPTION_MONTH_CHECK, 'EXTRACT(DAY FROM "last_charged_month") = 1')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_subscriptions_account_id')
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: SUBSCRIPTION_ACCOUNT_FK,
  })
  account?: Account;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents: number;

  @Column({ name: 'charge_day', type: 'smallint' })
  chargeDay: number;

  @Index('IDX_subscriptions_shop_id')
  @Column({ name: 'shop_id', type: 'uuid', nullable: true })
  shopId: string | null;

  @ManyToOne(() => Shop, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'shop_id',
    foreignKeyConstraintName: SUBSCRIPTION_SHOP_FK,
  })
  shop?: Shop | null;

  @Index('IDX_subscriptions_category_id')
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: SUBSCRIPTION_CATEGORY_FK,
  })
  category?: Category | null;

  /** First day of the last month already turned into a bill (YYYY-MM-01). */
  @Column({ name: 'last_charged_month', type: 'date' })
  lastChargedMonth: string;

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
}
