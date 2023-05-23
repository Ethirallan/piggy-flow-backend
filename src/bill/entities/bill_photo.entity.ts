import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne } from 'typeorm';
import { Bill } from './bill.entity';

@Entity()
export class BillPhoto {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Bill, bill => bill.photos)
  bill: Bill;

  @Column({type: 'text', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  name: string;

  @Column({type: 'text', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  path: string;

  @Column({type: 'text', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  blurhash: string;

  @CreateDateColumn()
  created: Date;
}
