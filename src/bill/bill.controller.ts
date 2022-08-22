import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req } from '@nestjs/common';
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';

@Controller('bill')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Post()
  create(@Req() req: any, @Body() createBillDto: CreateBillDto) {
    createBillDto.user = req.user;
    return this.billService.create(createBillDto);
  }

  @Get('getBillsByUser')
  async getBillsByUserId(@Req() req: any) {
    console.log(await this.billService.getBillsByUserId(req.user.id));
    return this.billService.getBillsByUserId(req.user.id);
  }

  @Get('getBillDetails:id')
  getBillDetails(@Param('id', ParseIntPipe) id: number) {
    return this.billService.getBillById(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateBillDto: UpdateBillDto) {
    return this.billService.update(id, updateBillDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.billService.remove(id);
  }
}
