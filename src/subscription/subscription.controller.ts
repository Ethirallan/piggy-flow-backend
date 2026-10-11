import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { BillService } from 'src/bill/bill.service';
import { CreateBillDto } from 'src/bill/dto/create-bill.dto';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService, private readonly billService: BillService) {}

  @Post()
  async create(@Req() req: any, @Body() createSubscriptionDto: CreateSubscriptionDto) {
    createSubscriptionDto.user = req.user;
    const subscription = await this.subscriptionService.create(createSubscriptionDto);
    return this.subscriptionService.getSubscriptionById(subscription.id);
  }

  @Get('getSubscriptionsByUser')
  async getSubscriptionsByUserId(@Req() req: any) {
    return this.subscriptionService.getSubscriptionsByUserId(req.user.id);
  }

  @Get('getSubscriptionDetails/:id')
  getSubscriptionDetails(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.subscriptionService.getOwned(id, req.user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() updateSubscriptionDto: UpdateSubscriptionDto) {
    if (!req.user) throw new NotFoundException();
    return this.subscriptionService.updateOwned(id, req.user.id, updateSubscriptionDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.subscriptionService.removeOwned(id, req.user.id);
  }

  @Get('insertSubscriptions/:secret')
  async insertSubscriptions(@Param('secret') secret: string) {
    if (secret === process.env.CRON_SECRET) {
      const day = new Date().getDate();
      const subscriptions = await this.subscriptionService.getSubscriptionsByDay(day);
      subscriptions.forEach(subscription => {
        const newBill = new CreateBillDto();
        newBill.user = subscription.user;
        newBill.account = subscription.account;
        newBill.shop = subscription.shop;
        newBill.category = subscription.category;
        newBill.price = subscription.price;
        newBill.comment = subscription.name;
        newBill.date = new Date();
        this.billService.create(newBill);
      });
    } else {
      throw new NotFoundException;
    }
  }
}
