import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccountService } from 'src/account/account.service';
import { assertAccountRef, assertRequiredAccountRef } from 'src/shared/account-ref';
import { pickFields } from 'src/shared/pick-fields';
import { assertSameList } from 'src/shared/same-list';
import { Subscription } from './entities/subscription.entity';

/** Subscription columns a client may set, on create or PATCH. Never id, user or timestamps. */
const CLIENT_FIELDS = ['account', 'chargeDay', 'shop', 'category', 'price', 'name'] as const;

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private accountService: AccountService,
    private dataSource: DataSource,
  ) { }

  /**
   * Creates a subscription. The account is required and must be one the user
   * belongs to. The shop and category must be from that account (R2). Only the
   * client fields and the user are saved, never an id: a client id would make
   * `save` overwrite that subscription instead of inserting a new one.
   */
  async createOwned(userId: number | undefined, dto: CreateSubscriptionDto) {
    const subscription = {
      ...pickFields<CreateSubscriptionDto, (typeof CLIENT_FIELDS)[number]>(dto, CLIENT_FIELDS),
      user: dto.user,
    };
    await assertRequiredAccountRef(subscription.account, userId, this.accountService);
    await assertSameList(this.dataSource.manager, subscription.account, subscription.shop, subscription.category);
    return this.subscriptionRepository.save(subscription);
  }

  async getSubscriptionById(id: number) {
    try {
      const subscription = await this.subscriptionRepository.findOneOrFail({
        where: {
          id: id
        },
        relations: ['user', 'account', 'shop', 'category']
      });
      return subscription;
    } catch (error) {
      throw new NotFoundException();
    }
  }

  /** The subscriptions of every account the user belongs to. */
  getSubscriptionsByUserId(id: number) {
    return this.subscriptionRepository.find({
      where: { account: { users: { id } } },
      relations: ['user', 'account', 'shop', 'category']
    });
  }

  async getOwned(id: number, userId: number | undefined): Promise<Subscription> {
    if (userId == null) throw new NotFoundException();
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: ['user', 'account', 'account.users', 'shop', 'category'],
    });
    if (!subscription?.account?.users?.some((u) => u.id === userId)) {
      throw new NotFoundException();
    }
    return subscription;
  }

  async updateOwned(id: number, userId: number | undefined, dto: UpdateSubscriptionDto) {
    const subscription = await this.getOwned(id, userId);
    const changes: Partial<Subscription> = {};
    for (const key of CLIENT_FIELDS) {
      if (key in dto && (dto as any)[key] !== undefined) (changes as any)[key] = (dto as any)[key];
    }
    if (Object.keys(changes).length === 0) return;
    // Missing means unchanged; null is a 400.
    await assertAccountRef(changes.account, userId, this.accountService);
    if ('account' in changes || 'shop' in changes || 'category' in changes) {
      await assertSameList(
        this.dataSource.manager,
        'account' in changes ? changes.account : subscription.account,
        'shop' in changes ? changes.shop : subscription.shop,
        'category' in changes ? changes.category : subscription.category,
      );
    }
    return this.subscriptionRepository.update(id, changes);
  }

  async removeOwned(id: number, userId: number | undefined) {
    await this.getOwned(id, userId);
    return this.subscriptionRepository.delete(id);
  }

  getSubscriptionsByDay(day: number) {
    return this.subscriptionRepository.find({
      where: {
        chargeDay: day
      },
      relations: ['user', 'account', 'shop', 'category']
    });
  }
}
