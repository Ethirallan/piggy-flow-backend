import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PersonalAccountService } from 'src/account/personal-account.service';
import { Repository } from 'typeorm';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './entities/shop.entity';

@Injectable()
export class ShopService {

  constructor(
    @InjectRepository(Shop)
    private shopRepository: Repository<Shop>,
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private personalAccounts: PersonalAccountService,
  ) { }

  /** Until clients can pick one, a new shop always goes into the creator's Personal account. */
  async create(createShopDto: CreateShopDto) {
    const userId = createShopDto.user?.id;
    if (userId == null) throw new NotFoundException();
    const account = await this.personalAccounts.ensurePersonal(userId);
    return this.shopRepository.save({ ...createShopDto, account });
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

  async getOwned(id: number, userId: number | undefined): Promise<Shop> {
    if (userId == null) throw new NotFoundException();
    const shop = await this.shopRepository.findOne({ where: { id, user: { id: userId } } });
    if (!shop) throw new NotFoundException();
    return shop;
  }

  async updateOwned(id: number, userId: number | undefined, dto: UpdateShopDto) {
    await this.getOwned(id, userId);
    return this.shopRepository.update(id, { name: dto.name });
  }

  async removeOwned(id: number, userId: number | undefined) {
    await this.getOwned(id, userId);
    const used =
      (await this.billRepository.count({ where: { shop: { id } } })) +
      (await this.subscriptionRepository.count({ where: { shop: { id } } }));
    if (used > 0) throw new ConflictException('In use');
    return this.shopRepository.delete(id);
  }
}
