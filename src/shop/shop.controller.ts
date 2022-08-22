import { Controller, Get, Post, Body, Patch, Param, Delete, Req, ParseIntPipe } from '@nestjs/common';
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
  update(@Param('id', ParseIntPipe) id: number, @Body() updateShopDto: UpdateShopDto) {
    return this.shopService.update(id, updateShopDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.shopService.remove(id);
  }
}
