import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

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
  update(@Param('id') id: string, @Body() updateSubscriptionDto: UpdateSubscriptionDto) {
    return this.subscriptionService.update(+id, updateSubscriptionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.subscriptionService.remove(+id);
  }
}
