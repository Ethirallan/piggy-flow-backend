import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './entities/shop.entity';

@Injectable()
export class ShopService {

  constructor(
    @InjectRepository(Shop)
    private shopRepository: Repository<Shop>,
  ) { }

  create(createShopDto: CreateShopDto) {
    return this.shopRepository.save(createShopDto);
  }

  getShopsByUserId(id: number) {
    return this.shopRepository.find({
      where: {
        user: {
          id: id
        }
      }
    });
  }

  async update(id: number, updateShopDto: UpdateShopDto) {
    const updateResult = await this.shopRepository.update(id, updateShopDto);

    if (updateResult.affected === 0) {
      throw new NotFoundException(`Shop with ID "${id}" not found`);
    }
  }

  async remove(id: number) {
    const deleteResult = await this.shopRepository.delete(id);
    if (deleteResult.affected === 0) {
      throw new NotFoundException(`Shop with ID "${id}" not found`);
    }
  }
}
