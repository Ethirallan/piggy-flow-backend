import { Bill } from 'src/bill/entities/bill.entity';
import { Category } from 'src/category/entities/category.entity';
import { Shop } from 'src/shop/entities/shop.entity';
import { User } from 'src/user/entities/user.entity';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToMany, OneToMany } from 'typeorm';

@Entity()
export class Account {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToMany(() => User, (user) => user.accounts)
  users: User[]

  @Column({type: 'varchar', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  name: string;

  @Column({ default: false })
  personal: boolean;

  @CreateDateColumn()
  created: Date;

  @UpdateDateColumn()
  lastUpdate: Date;

  @OneToMany(() => Bill, bill => bill.account)
  bills: Bill[];

  @OneToMany(() => Shop, (shop) => shop.account)
  shops: Shop[];

  @OneToMany(() => Category, (category) => category.account)
  categories: Category[];
}
