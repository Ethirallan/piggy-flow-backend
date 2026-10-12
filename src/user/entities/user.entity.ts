import { Account } from 'src/account/entities/account.entity';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToMany, JoinTable } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({type: 'varchar', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  uid: string;

  @Column({type: 'varchar', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  email: string;

  @Column({type: 'varchar', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  displayName: string;

  @CreateDateColumn()
  created: Date;

  @UpdateDateColumn()
  lastUpdate: Date;

  @ManyToMany(() => Account, (account) => account.users)
  @JoinTable()
  accounts: Account[]

  @OneToMany(() => Bill, bill => bill.user)
  bills: Bill[];

  @OneToMany(() => Subscription, subscription => subscription.user)
  subscriptions: Subscription[];
}
