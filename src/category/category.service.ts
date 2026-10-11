import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PersonalAccountService } from 'src/account/personal-account.service';
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
  ) { }

  /** Until clients can pick one, a new category always goes into the creator's Personal account. */
  async create(createCategoryDto: CreateCategoryDto) {
    const userId = createCategoryDto.user?.id;
    if (userId == null) throw new NotFoundException();
    const account = await this.personalAccounts.ensurePersonal(userId);
    return this.categoryRepository.save({ ...createCategoryDto, account });
  }

  getCategoriesByUserId(id: number) {
    return this.categoryRepository.find({
      where: {
        user: { 
          id: id 
        } 
      }
    });
  }

  async getOwned(id: number, userId: number | undefined): Promise<Category> {
    if (userId == null) throw new NotFoundException();
    const category = await this.categoryRepository.findOne({ where: { id, user: { id: userId } } });
    if (!category) throw new NotFoundException();
    return category;
  }

  async updateOwned(id: number, userId: number | undefined, dto: UpdateCategoryDto) {
    await this.getOwned(id, userId);
    return this.categoryRepository.update(id, { name: dto.name, emoji: dto.emoji });
  }

  async removeOwned(id: number, userId: number | undefined) {
    await this.getOwned(id, userId);
    const used =
      (await this.billRepository.count({ where: { category: { id } } })) +
      (await this.subscriptionRepository.count({ where: { category: { id } } }));
    if (used > 0) throw new ConflictException('In use');
    return this.categoryRepository.delete(id);
  }
}
