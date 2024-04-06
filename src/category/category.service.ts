import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoryService {

  constructor(
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
  ) { }

  create(createCategoryDto: CreateCategoryDto) {
    return this.categoryRepository.save(createCategoryDto);
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

  async update(id: number, updateCategoryDto: UpdateCategoryDto) {
    const updateResult = await this.categoryRepository.update(id, updateCategoryDto);

    if (updateResult.affected === 0) {
      throw new NotFoundException(`Category with ID "${id}" not found`);
    }
  }

  async remove(id: number) {
    const deleteResult = await this.categoryRepository.delete(id);
    if (deleteResult.affected === 0) {
      throw new NotFoundException(`Category with ID "${id}" not found`);
    }
  }
}
