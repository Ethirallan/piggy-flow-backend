import { Bill } from 'src/bill/entities/bill.entity';
import { Category } from 'src/category/entities/category.entity';
import { Shop } from 'src/shop/entities/shop.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
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

  @CreateDateColumn()
  created: Date;

  @UpdateDateColumn()
  lastUpdate: Date;

  @OneToMany(() => Bill, bill => bill.account)
  bills: Bill[];

  @OneToMany(() => Category, category => category.account)
  categories: Category[];

  @OneToMany(() => Shop, shop => shop.account)
  shops: Shop[];

  @OneToMany(() => Subscription, subscription => subscription.account)
  subscriptions: Subscription[];
}
