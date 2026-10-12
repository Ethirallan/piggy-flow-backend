import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, NotFoundException, Query } from '@nestjs/common';
import { parseAccountQuery } from 'src/shared/account-scoped';
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

  @Get()
  list(@Req() req: any, @Query('account') account?: string) {
    return this.categoryService.listForUser(req.user?.id, parseAccountQuery(account));
  }

  @Get('getCategoriesByUser')
  getCategoriesByUserId(@Req() req: any) {
    return this.categoryService.listForUser(req.user?.id);
  }

  @Post(':id/copy')
  copy(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: { account?: unknown }) {
    return this.categoryService.copy(id, req.user, body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() updateCategoryDto: UpdateCategoryDto) {
    if (!req.user) throw new NotFoundException();
    return this.categoryService.updateAsMember(id, req.user.id, updateCategoryDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.categoryService.removeAsMember(id, req.user.id);
  }
}
