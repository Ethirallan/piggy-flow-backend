import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountService } from 'src/account/account.service';
import { assertAccountRef } from 'src/shared/account-ref';
import { assertSomethingToUpdate, deleteOrInUse, hasNameClash, listInAccounts, loadAsMember } from 'src/shared/account-scoped';
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
    return listInAccounts(this.shopRepository, this.accounts, userId, accountId);
  }

  async updateAsMember(id: number, userId: number | undefined, dto: UpdateShopDto) {
    await loadAsMember(this.shopRepository, id, userId, this.accounts);
    assertSomethingToUpdate(dto.name);
    return this.shopRepository.update(id, { name: dto.name });
  }

  async removeAsMember(id: number, userId: number | undefined) {
    await loadAsMember(this.shopRepository, id, userId, this.accounts);
    const used =
      (await this.billRepository.count({ where: { shop: { id } } })) +
      (await this.subscriptionRepository.count({ where: { shop: { id } } }));
    if (used > 0) throw new ConflictException('In use');
    return deleteOrInUse(() => this.shopRepository.delete(id));
  }

  /** Copies a shop into another account the user belongs to. */
  async copy(id: number, user: { id: number } | undefined, dto: { account?: unknown }) {
    const source = await loadAsMember(this.shopRepository, id, user?.id, this.accounts);
    if (dto?.account == null) throw new BadRequestException('Invalid account.');
    await assertAccountRef(dto.account, user.id, this.accounts);
    const target = dto.account as { id: number };
    const existing = await this.shopRepository.find({ where: { account: { id: target.id } } });
    if (hasNameClash(existing, source.name)) throw new ConflictException('Already exists');
    const saved = await this.shopRepository.save({ name: source.name, account: { id: target.id }, user });
    return this.shopRepository.findOne({ where: { id: saved.id }, relations: ['account'] });
  }
}
