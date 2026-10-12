import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountService } from 'src/account/account.service';
import { PersonalAccountService } from 'src/account/personal-account.service';
import { assertAccountRef } from 'src/shared/account-ref';
import { assertSomethingToUpdate, deleteOrInUse, hasNameClash, listInAccounts, loadAsMember } from 'src/shared/account-scoped';
import { Repository } from 'typeorm';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoryService {

  constructor(
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private personalAccounts: PersonalAccountService,
    private accounts: AccountService,
  ) { }

  async create(createCategoryDto: CreateCategoryDto) {
    const userId = createCategoryDto.user?.id;
    if (userId == null) throw new NotFoundException();
    await assertAccountRef(createCategoryDto.account, userId, this.accounts);
    const account = createCategoryDto.account ?? (await this.personalAccounts.ensurePersonal(userId));
    const saved = await this.categoryRepository.save({
      name: createCategoryDto.name,
      emoji: createCategoryDto.emoji,
      user: createCategoryDto.user,
      account,
    });
    return this.categoryRepository.findOne({ where: { id: saved.id }, relations: ['account'] });
  }

  /** The categories of one account the user belongs to, or of all their accounts. */
  async listForUser(userId: number | undefined, accountId?: number) {
    return listInAccounts(this.categoryRepository, this.accounts, userId, accountId);
  }

  async updateAsMember(id: number, userId: number | undefined, dto: UpdateCategoryDto) {
    await loadAsMember(this.categoryRepository, id, userId, this.accounts);
    assertSomethingToUpdate(dto.name, dto.emoji);
    return this.categoryRepository.update(id, { name: dto.name, emoji: dto.emoji });
  }

  async removeAsMember(id: number, userId: number | undefined) {
    await loadAsMember(this.categoryRepository, id, userId, this.accounts);
    const used =
      (await this.billRepository.count({ where: { category: { id } } })) +
      (await this.subscriptionRepository.count({ where: { category: { id } } }));
    if (used > 0) throw new ConflictException('In use');
    return deleteOrInUse(() => this.categoryRepository.delete(id));
  }

  /** Copies a category (name and emoji) into another account the user belongs to. */
  async copy(id: number, user: { id: number } | undefined, dto: { account?: unknown }) {
    const source = await loadAsMember(this.categoryRepository, id, user?.id, this.accounts);
    if (dto?.account == null) throw new BadRequestException('Invalid account.');
    await assertAccountRef(dto.account, user.id, this.accounts);
    const target = dto.account as { id: number };
    const existing = await this.categoryRepository.find({ where: { account: { id: target.id } } });
    if (hasNameClash(existing, source.name)) throw new ConflictException('Already exists');
    const saved = await this.categoryRepository.save({ name: source.name, emoji: source.emoji, account: { id: target.id }, user });
    return this.categoryRepository.findOne({ where: { id: saved.id }, relations: ['account'] });
  }
}
