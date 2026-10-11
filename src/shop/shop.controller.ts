import { Controller, Get, Post, Body, Patch, Param, Delete, Req, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { ShopService } from './shop.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';

@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Post()
  create(@Req() req: any, @Body() createShopDto: CreateShopDto) {
    createShopDto.user = req.user;
    return this.shopService.create(createShopDto);
  }

  @Get('getShopsByUser')
  getShopsByUserId(@Req() req: any) {
    return this.shopService.getShopsByUserId(req.user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() updateShopDto: UpdateShopDto) {
    if (!req.user) throw new NotFoundException();
    return this.shopService.updateOwned(id, req.user.id, updateShopDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.shopService.removeOwned(id, req.user.id);
  }
}
