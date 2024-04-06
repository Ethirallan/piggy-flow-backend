import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { BillService } from 'src/bill/bill.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let subscriptionService: SubscriptionService;
  let billService: BillService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        {
          provide: 'SUBSCRIPTION_SERVICE',
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 1 }),
            getSubscriptionById: jest.fn().mockResolvedValue('subscription'),
            getSubscriptionsByUserId: jest.fn().mockResolvedValue('subscriptions'),
            update: jest.fn().mockResolvedValue('update'),
            remove: jest.fn().mockResolvedValue('remove'),
            getSubscriptionsByDay: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: 'BILL_SERVICE',
          useValue: {
            create: jest.fn().mockResolvedValue('bill'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('secret'),
          },
        },
      ],
    }).compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
    subscriptionService = module.get<SubscriptionService>('SUBSCRIPTION_SERVICE');
    billService = module.get<BillService>('BILL_SERVICE');
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(subscriptionService).toBeDefined();
    expect(billService).toBeDefined();
    expect(configService).toBeDefined();
  });

  it('should create a subscription and return it', async () => {
    const dto = new CreateSubscriptionDto();
    dto.name = 'Test Subscription';
    expect(await controller.create({ user: { id: 1 } }, dto)).toEqual('subscription');
    expect(subscriptionService.create).toHaveBeenCalledWith({ ...dto, user: { id: 1 } });
    expect(subscriptionService.getSubscriptionById).toHaveBeenCalledWith(1);
  });

  it('should get subscriptions by user id and return them', async () => {
    expect(await controller.getSubscriptionsByUserId({ user: { id: 1 } })).toEqual('subscriptions');
    expect(subscriptionService.getSubscriptionsByUserId).toHaveBeenCalledWith(1);
  });

  it('should get subscription details by id and return them', async () => {
    expect(await controller.getSubscriptionDetails(1)).toEqual('subscription');
    expect(subscriptionService.getSubscriptionById).toHaveBeenCalledWith(1);
  });

  it('should update a subscription and return the result', async () => {
    const dto = new UpdateSubscriptionDto();
    dto.name = 'Updated Subscription';
    expect(await controller.update(1, dto)).toEqual('update');
    expect(subscriptionService.update).toHaveBeenCalledWith(1, dto);
  });

  it('should remove a subscription and return the result', async () => {
    expect(await controller.remove(1)).toEqual('remove');
    expect(subscriptionService.remove).toHaveBeenCalledWith(1);
  });

  it('should insert subscriptions and return nothing', async () => {
    expect(await controller.insertSubscriptions('secret')).toBeUndefined();
    expect(subscriptionService.getSubscriptionsByDay).toHaveBeenCalledWith(new Date().getDate());
    expect(billService.create).toHaveBeenCalledTimes(0);
  });

  it('should insert subscriptions and create a bill for each subscription', async () => {
    const subscriptions = [
      { user: 'user1', account: 'account1', shop: 'shop1', category: 'category1', price: 1, name: 'name1' },
      { user: 'user2', account: 'account2', shop: 'shop2', category: 'category2', price: 2, name: 'name2' },
    ];
    (subscriptionService.getSubscriptionsByDay as jest.Mock).mockResolvedValue(subscriptions);
    await controller.insertSubscriptions('secret');
    expect(subscriptionService.getSubscriptionsByDay).toHaveBeenCalledWith(new Date().getDate());
    expect(billService.create).toHaveBeenCalledTimes(subscriptions.length);
    subscriptions.forEach((subscription, index) => {
      expect(billService.create).toHaveBeenNthCalledWith(index + 1, {
        user: subscription.user,
        account: subscription.account,
        shop: subscription.shop,
        category: subscription.category,
        price: subscription.price,
        comment: subscription.name,
        date: expect.any(Date),
      });
    });
  });

  it('should throw an error if the secret is incorrect', async () => {
    await expect(controller.insertSubscriptions('incorrect')).rejects.toThrow(NotFoundException);
  });
});