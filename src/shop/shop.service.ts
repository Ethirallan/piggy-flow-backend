import { Injectable } from '@nestjs/common';
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

  update(id: number, updateShopDto: UpdateShopDto) {
    return this.shopRepository.update(id, updateShopDto);
  }

  remove(id: number) {
    return this.shopRepository.delete(id);
  }
}
