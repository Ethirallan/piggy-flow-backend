import { Test, TestingModule } from '@nestjs/testing';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

describe('CategoryController', () => {
  let controller: CategoryController;
  let service: CategoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [
        {
          provide: 'CATEGORY_SERVICE',
          useValue: {
            create: jest.fn().mockResolvedValue('create'),
            getCategoriesByUserId: jest.fn().mockResolvedValue('getCategoriesByUserId'),
            update: jest.fn().mockResolvedValue('update'),
            remove: jest.fn().mockResolvedValue('remove'),
          },
        },
      ],
    }).compile();

    controller = module.get<CategoryController>(CategoryController);
    service = module.get<CategoryService>('CATEGORY_SERVICE');
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('should create a category and return the result', async () => {
    const dto = new CreateCategoryDto();
    dto.name = 'Test Category';
    expect(await controller.create({ user: { id: 1 } }, dto)).toEqual('create');
    expect(service.create).toHaveBeenCalledWith({ ...dto, user: { id: 1 } });
  });

  it('should get categories by user id and return the result', async () => {
    expect(await controller.getCategoriesByUserId({ user: { id: 1 } })).toEqual('getCategoriesByUserId');
    expect(service.getCategoriesByUserId).toHaveBeenCalledWith(1);
  });

  it('should update a category and return the result', async () => {
    const dto = new UpdateCategoryDto();
    dto.name = 'Updated Category';
    expect(await controller.update(1, dto)).toEqual('update');
    expect(service.update).toHaveBeenCalledWith(1, dto);
  });

  it('should remove a category and return the result', async () => {
    expect(await controller.remove(1)).toEqual('remove');
    expect(service.remove).toHaveBeenCalledWith(1);
  });
});