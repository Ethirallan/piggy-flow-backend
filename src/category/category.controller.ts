import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, NotFoundException } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  create(@Req() req: any, @Body() createCategoryDto: CreateCategoryDto) {
    createCategoryDto.user = req.user;
    return this.categoryService.create(createCategoryDto);
  }

  @Get('getCategoriesByUser')
  getCategoriesByUserId(@Req() req: any) {
    return this.categoryService.getCategoriesByUserId(req.user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() updateCategoryDto: UpdateCategoryDto) {
    if (!req.user) throw new NotFoundException();
    return this.categoryService.updateOwned(id, req.user.id, updateCategoryDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.categoryService.removeOwned(id, req.user.id);
  }
}
