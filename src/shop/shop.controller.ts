import { Controller, Get, Post, Body, Patch, Param, Delete, Req, ParseIntPipe, NotFoundException, Query, BadRequestException } from '@nestjs/common';
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

  @Get()
  list(@Req() req: any, @Query('account') account?: string) {
    if (account !== undefined && !/^\d+$/.test(account)) throw new BadRequestException('Invalid account.');
    return this.shopService.listForUser(req.user?.id, account === undefined ? undefined : Number(account));
  }

  @Get('getShopsByUser')
  getShopsByUserId(@Req() req: any) {
    return this.shopService.listForUser(req.user?.id);
  }

  @Post(':id/copy')
  copy(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: { account?: unknown }) {
    return this.shopService.copy(id, req.user, body);
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
