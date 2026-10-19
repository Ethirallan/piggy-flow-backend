import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Bill } from '../bills/bill.entity.js';
import { User } from '../users/user.entity.js';

/** A receipt photo; the file is `<uploads>/<id>.jpg`. Never edited, only added or removed. */
@Entity('bill_photos')
export class BillPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_bill_photos_bill_id')
  @Column({ name: 'bill_id', type: 'uuid' })
  billId: string;

  @ManyToOne(() => Bill, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bill_id' })
  bill?: Bill;

  /** The uploaded file's name, for display. */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** As displayed. */
  @Column({ type: 'integer' })
  width: number;

  /** As displayed. */
  @Column({ type: 'integer' })
  height: number;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
