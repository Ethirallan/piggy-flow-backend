import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { Repository } from 'typeorm';
import { Shop } from './entities/shop.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { NotFoundException } from '@nestjs/common';

describe('ShopService', () => {
  let service: ShopService;
  let shopRepository: Repository<Shop>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopService,
        {
          provide: getRepositoryToken(Shop),
          useValue: {
            save: jest.fn().mockResolvedValue('shop'),
            find: jest.fn().mockResolvedValue(['shop1', 'shop2']),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<ShopService>(ShopService);
    shopRepository = module.get<Repository<Shop>>(getRepositoryToken(Shop));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(shopRepository).toBeDefined();
  });

  it('should create a shop', async () => {
    const dto = new CreateShopDto();
    expect(await service.create(dto)).toEqual('shop');
    expect(shopRepository.save).toHaveBeenCalledWith(dto);
  });

  it('should get shops by user id', async () => {
    expect(await service.getShopsByUserId(1)).toEqual(['shop1', 'shop2']);
    expect(shopRepository.find).toHaveBeenCalledWith({
      where: {
        user: {
          id: 1
        }
      }
    });
  });

  it('should update a shop', async () => {
    const dto = new UpdateShopDto();
    await service.update(1, dto);
    expect(shopRepository.update).toHaveBeenCalledWith(1, dto);
  });

  it('should throw an error if no shop is updated', async () => {
    (shopRepository.update as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.update(1, new UpdateShopDto())).rejects.toThrow(NotFoundException);
  });

  it('should remove a shop', async () => {
    await service.remove(1);
    expect(shopRepository.delete).toHaveBeenCalledWith(1);
  });

  it('should throw an error if no shop is removed', async () => {
    (shopRepository.delete as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.remove(1)).rejects.toThrow(NotFoundException);
  });
});