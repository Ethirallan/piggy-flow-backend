import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, NotFoundException, Inject } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { BillService } from 'src/bill/bill.service';
import { CreateBillDto } from 'src/bill/dto/create-bill.dto';
import { ConfigService } from '@nestjs/config';

@Controller('subscription')
export class SubscriptionController {
  constructor(
    @Inject('SUBSCRIPTION_SERVICE') private readonly subscriptionService: SubscriptionService,
    @Inject('BILL_SERVICE') private readonly billService: BillService,
    private readonly configService: ConfigService,
  ) { }

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
  getSubscriptionDetails(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptionService.getSubscriptionById(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateSubscriptionDto: UpdateSubscriptionDto) {
    return this.subscriptionService.update(id, updateSubscriptionDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptionService.remove(id);
  }

  @Get('insertSubscriptions/:secret')
  async insertSubscriptions(@Param('secret') secret: string) {
    if (secret === this.configService.get('CRON_SECRET')) {
      const day = new Date().getDate();
      const subscriptions = await this.subscriptionService.getSubscriptionsByDay(day);
      for (const subscription of subscriptions) {
        const newBill = new CreateBillDto();
        newBill.user = subscription.user;
        newBill.account = subscription.account;
        newBill.shop = subscription.shop;
        newBill.category = subscription.category;
        newBill.price = subscription.price;
        newBill.comment = subscription.name;
        newBill.date = new Date();
        await this.billService.create(newBill);
      }
    } else {
      throw new NotFoundException;
    }
  }
}
