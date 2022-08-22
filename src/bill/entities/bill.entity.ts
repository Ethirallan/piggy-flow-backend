import { Account } from 'src/account/entities/account.entity';
import { Category } from 'src/category/entities/category.entity';
import { DecimalTransformer } from 'src/shared/decimal-transformer';
import { Shop } from 'src/shop/entities/shop.entity';
import { User } from 'src/user/entities/user.entity';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { BillPhoto } from './bill_photo.entity';

@Entity()
export class Bill {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.bills)
  user: User;

  @ManyToOne(() => Account, account => account.bills, { nullable: true })
  account: Account;

  @Column()
  date: Date;

  @ManyToOne(() => Shop, shop => shop.bills, { nullable: true })
  shop: Shop;

  @ManyToOne(() => Category, category => category.bills, { nullable: true })
  category: Category;

  @Column({type: 'decimal', precision: 10, scale: 2, transformer: new DecimalTransformer()})
  price: number;

  @Column({type: 'text', charset: "utf8mb4", collation: "utf8mb4_unicode_ci", nullable: true})
  comment: string;

  @CreateDateColumn()
  created: Date;

  @UpdateDateColumn()
  lastUpdate: Date;

  @OneToMany(() => BillPhoto, photo => photo.bill)
  photos: BillPhoto[];
}
