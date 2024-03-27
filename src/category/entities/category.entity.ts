import { Account } from 'src/account/entities/account.entity';
import { Bill } from 'src/bill/entities/bill.entity';
import { User } from 'src/user/entities/user.entity';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';

@Entity()
export class Category {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.categories)
  user: User;

  @ManyToOne(() => Account, account => account.categories, { nullable: true })
  account: Account;

  @Column({type: 'varchar', charset: "utf8mb4", collation: "utf8mb4_unicode_ci"})
  name: string;

  @Column({type: 'varchar', length: 20, charset: "utf8mb4", collation: "utf8mb4_unicode_ci", nullable: true})
  emoji: string;

  @CreateDateColumn()
  created: Date;

  @UpdateDateColumn()
  lastUpdate: Date;

  @OneToMany(() => Bill, bill => bill.category)
  bills: Bill[];
}
