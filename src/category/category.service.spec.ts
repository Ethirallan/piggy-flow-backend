import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from './category.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

describe('CategoryService', () => {
  let service: CategoryService;
  let categoryRepository: Repository<Category>;
  const CATEGORY_REPOSITORY_TOKEN = getRepositoryToken(Category);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        {
          provide: getRepositoryToken(Category),
          useValue: {
            save: jest.fn().mockResolvedValue('category'),
            find: jest.fn().mockResolvedValue(['category1', 'category2']),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<CategoryService>(CategoryService);
    categoryRepository = module.get<Repository<Category>>(CATEGORY_REPOSITORY_TOKEN);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(categoryRepository).toBeDefined();
  });

  it('should create a category', async () => {
    const dto = new CreateCategoryDto();
    expect(await service.create(dto)).toEqual('category');
    expect(categoryRepository.save).toHaveBeenCalledWith(dto);
  });

  it('should get categories by user id', async () => {
    expect(await service.getCategoriesByUserId(1)).toEqual(['category1', 'category2']);
    expect(categoryRepository.find).toHaveBeenCalledWith({
      where: {
        user: {
          id: 1
        }
      }
    });
  });

  it('should update a category', async () => {
    const dto = new UpdateCategoryDto();
    await service.update(1, dto);
    expect(categoryRepository.update).toHaveBeenCalledWith(1, dto);
  });

  it('should throw an error if no category is updated', async () => {
    (categoryRepository.update as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.update(1, new UpdateCategoryDto())).rejects.toThrow();
  });

  it('should remove a category', async () => {
    await service.remove(1);
    expect(categoryRepository.delete).toHaveBeenCalledWith(1);
  });

  it('should throw an error if no category is removed', async () => {
    (categoryRepository.delete as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.remove(1)).rejects.toThrow();
  });
});