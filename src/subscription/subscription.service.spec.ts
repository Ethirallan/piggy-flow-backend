import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { Repository } from 'typeorm';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { NotFoundException } from '@nestjs/common';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subscriptionRepository: Repository<Subscription>;
  const SUBSCRIPTION_REPOSITORY_TOKEN = getRepositoryToken(Subscription);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: SUBSCRIPTION_REPOSITORY_TOKEN,
          useValue: {
            save: jest.fn().mockResolvedValue('subscription'),
            find: jest.fn().mockResolvedValue('subscriptions'),
            findOne: jest.fn().mockResolvedValue('subscription'),
            findOneOrFail: jest.fn().mockResolvedValue('subscription'),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    subscriptionRepository = module.get<Repository<Subscription>>(SUBSCRIPTION_REPOSITORY_TOKEN);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(subscriptionRepository).toBeDefined();
  });

  it('should create a subscription', async () => {
    const dto = new CreateSubscriptionDto();
    expect(await service.create(dto)).toEqual('subscription');
    expect(subscriptionRepository.save).toHaveBeenCalledWith(dto);
  });

  it('should get subscriptions by user id', async () => {
    expect(await service.getSubscriptionsByUserId(1)).toEqual('subscriptions');
    expect(subscriptionRepository.find).toHaveBeenCalledWith({
      where: {
        user: {
          id: 1
        }
      },
      relations: ['user', 'account', 'shop', 'category']
    });
  });

  it('should get subscription by id', async () => {
    expect(await service.getSubscriptionById(1)).toEqual('subscription');
    expect(subscriptionRepository.findOneOrFail).toHaveBeenCalledWith({
      where: {
        id: 1
      },
      relations: ['user', 'account', 'shop', 'category']
    });
  });

  it('should throw a NotFoundException if no subscription is found', async () => {
    (subscriptionRepository.findOneOrFail as jest.Mock).mockRejectedValue(new Error());
    await expect(service.getSubscriptionById(1)).rejects.toThrow(NotFoundException);
  });

  it('should update a subscription', async () => {
    const dto = new UpdateSubscriptionDto();
    await service.update(1, dto);
    expect(subscriptionRepository.update).toHaveBeenCalledWith(1, dto);
  });

  it('should throw an error if no subscription is updated', async () => {
    (subscriptionRepository.update as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.update(1, new UpdateSubscriptionDto())).rejects.toThrow(NotFoundException);
  });

  it('should remove a subscription', async () => {
    await service.remove(1);
    expect(subscriptionRepository.delete).toHaveBeenCalledWith(1);
  });

  it('should throw an error if no subscription is removed', async () => {
    (subscriptionRepository.delete as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.remove(1)).rejects.toThrow(NotFoundException);
  });

  it('should get subscriptions by day', async () => {
    expect(await service.getSubscriptionsByDay(1)).toEqual('subscriptions');
    expect(subscriptionRepository.find).toHaveBeenCalledWith({
      where: {
        chargeDay: 1
      },
      relations: ['user', 'account', 'shop', 'category']
    });
  });
});