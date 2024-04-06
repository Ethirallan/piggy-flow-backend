import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
  ) { }

  create(createSubscriptionDto: CreateSubscriptionDto) {
    return this.subscriptionRepository.save(createSubscriptionDto);
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

  async update(id: number, updateSubscriptionDto: UpdateSubscriptionDto) {
    const updateResult = await this.subscriptionRepository.update(id, updateSubscriptionDto);
    if (updateResult.affected === 0) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
  }

  async remove(id: number) {
    const deleteResult = await this.subscriptionRepository.delete(id);
    if (deleteResult.affected === 0) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
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
