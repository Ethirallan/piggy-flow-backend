import { Test, TestingModule } from '@nestjs/testing';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { CreateShopDto } from './dto/create-shop.dto';

describe('ShopController', () => {
  let controller: ShopController;
  let service: ShopService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopController],
      providers: [
        {
          provide: 'SHOP_SERVICE',
          useValue: {
            create: jest.fn(),
            getShopsByUserId: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ShopController>(ShopController);
    service = module.get<ShopService>('SHOP_SERVICE');
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('should create a shop', () => {
    const dto = { name: 'Test Shop', user: { id: 1, uid: 'uid', email: 'user@email.com', displayName: 'User 1' } };
    controller.create({ user: { id: 1 } }, dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('should extract user from request and create a shop', () => {
    const req = { user: { id: 1 } };
    const dto = new CreateShopDto();
    dto.name = 'Test Shop';

    controller.create(req, dto);

    expect(service.create).toHaveBeenCalledWith({ ...dto, user: req.user });
  });

  it('should get shops by user id', () => {
    controller.getShopsByUserId({ user: { id: 1 } });
    expect(service.getShopsByUserId).toHaveBeenCalledWith(1);
  });

  it('should update a shop', () => {
    const dto = { name: 'Updated Shop' };
    controller.update(1, dto);
    expect(service.update).toHaveBeenCalledWith(1, dto);
  });

  it('should remove a shop', () => {
    controller.remove(1);
    expect(service.remove).toHaveBeenCalledWith(1);
  });
});