import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountService } from 'src/account/account.service';
import { assertAccountRef } from 'src/shared/account-ref';
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
    private accounts: AccountService,
  ) { }

  async create(createShopDto: CreateShopDto) {
    const userId = createShopDto.user?.id;
    if (userId == null) throw new NotFoundException();
    await assertAccountRef(createShopDto.account, userId, this.accounts);
    const account = createShopDto.account ?? (await this.personalAccounts.ensurePersonal(userId));
    const saved = await this.shopRepository.save({ name: createShopDto.name, user: createShopDto.user, account });
    return this.shopRepository.findOne({ where: { id: saved.id }, relations: ['account'] });
  }

  /** The shops of one account the user belongs to, or of all their accounts. */
  async listForUser(userId: number | undefined, accountId?: number) {
    if (accountId !== undefined) {
      await this.accounts.assertMember(accountId, userId);
      return this.shopRepository.find({ where: { account: { id: accountId } }, relations: ['account'] });
    }
    if (userId == null) throw new NotFoundException();
    return this.shopRepository.find({ where: { account: { users: { id: userId } } }, relations: ['account'] });
  }

  /** The shop, if the user belongs to its account. A shop without an account counts as not found. */
  private async getAsMember(id: number, userId: number | undefined): Promise<Shop> {
    if (userId == null) throw new NotFoundException();
    const shop = await this.shopRepository.findOne({ where: { id }, relations: ['account'] });
    if (!shop?.account) throw new NotFoundException();
    await this.accounts.assertMember(shop.account.id, userId);
    return shop;
  }

  async updateOwned(id: number, userId: number | undefined, dto: UpdateShopDto) {
    await this.getAsMember(id, userId);
    if (typeof dto.name !== 'string' || dto.name.trim() === '') throw new BadRequestException('Nothing to update.');
    return this.shopRepository.update(id, { name: dto.name });
  }

  async removeOwned(id: number, userId: number | undefined) {
    await this.getAsMember(id, userId);
    const used =
      (await this.billRepository.count({ where: { shop: { id } } })) +
      (await this.subscriptionRepository.count({ where: { shop: { id } } }));
    if (used > 0) throw new ConflictException('In use');
    try {
      return await this.shopRepository.delete(id);
    } catch (e) {
      // A bill took the shop between the check and the delete (ER_ROW_IS_REFERENCED_2).
      if ((e as any)?.driverError?.errno === 1451 || (e as any)?.errno === 1451) throw new ConflictException('In use');
      throw e;
    }
  }

  /** Copies a shop into another account the user belongs to. */
  async copy(id: number, user: { id: number } | undefined, dto: { account?: unknown }) {
    const source = await this.getAsMember(id, user?.id);
    if (dto?.account == null) throw new BadRequestException('Invalid account.');
    await assertAccountRef(dto.account, user.id, this.accounts);
    const target = dto.account as { id: number };
    const wanted = source.name.trim().toLowerCase();
    const existing = await this.shopRepository.find({ where: { account: { id: target.id } } });
    if (existing.some((s) => s.name.trim().toLowerCase() === wanted)) throw new ConflictException('Already exists');
    const saved = await this.shopRepository.save({ name: source.name, account: { id: target.id }, user });
    return this.shopRepository.findOne({ where: { id: saved.id }, relations: ['account'] });
  }
}
