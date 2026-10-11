import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountService } from 'src/account/account.service';
import { Subscription } from './entities/subscription.entity';

const UPDATABLE_FIELDS = ['account', 'chargeDay', 'shop', 'category', 'price', 'name'] as const;

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private accountService: AccountService,
  ) { }

  create(createSubscriptionDto: CreateSubscriptionDto) {
    return this.subscriptionRepository.save(createSubscriptionDto);
  }

  /** Creates a subscription; a target account must be one the user belongs to. */
  async createOwned(userId: number | undefined, dto: CreateSubscriptionDto) {
    await this.assertTargetAccount(dto.account, userId);
    return this.create(dto);
  }

  private async assertTargetAccount(account: { id?: number } | null | undefined, userId: number | undefined) {
    if (account?.id != null) await this.accountService.assertMember(account.id, userId);
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

  getSubscriptionsByUserId(id: number) {
    return this.subscriptionRepository.find({
      where: {
        user: {
          id: id
        }
      },
      relations: ['user', 'account', 'shop', 'category']
    });
  }

  async getOwned(id: number, userId: number | undefined): Promise<Subscription> {
    if (userId == null) throw new NotFoundException();
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: ['user', 'account', 'account.users', 'shop', 'category'],
    });
    if (
      !subscription ||
      !(subscription.user?.id === userId || subscription.account?.users?.some((u) => u.id === userId))
    ) {
      throw new NotFoundException();
    }
    return subscription;
  }

  async updateOwned(id: number, userId: number | undefined, dto: UpdateSubscriptionDto) {
    await this.getOwned(id, userId);
    const changes: Partial<Subscription> = {};
    for (const key of UPDATABLE_FIELDS) {
      if (key in dto && (dto as any)[key] !== undefined) (changes as any)[key] = (dto as any)[key];
    }
    if (Object.keys(changes).length === 0) return;
    await this.assertTargetAccount(changes.account, userId);
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
