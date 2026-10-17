import {
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

/** Unique (account_id, lower(name)); created by hand in the migration. */
export const CATEGORY_NAME_INDEX = 'UQ_categories_account_id_lower_name';

/** A category an account's bills can be tagged with. */
@Entity('categories')
@Index(CATEGORY_NAME_INDEX, { synchronize: false })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Exactly one emoji, or null. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  emoji: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
