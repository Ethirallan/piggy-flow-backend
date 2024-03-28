import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req } from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UserService } from 'src/user/user.service';
import { BillService } from 'src/bill/bill.service';

@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly userService: UserService,
    private readonly billService: BillService,
  ) { }

  @Post()
  create(@Req() req: any, @Body() createAccountDto: CreateAccountDto) {
    createAccountDto.users = [...createAccountDto.users ?? [], req.user];
    return this.accountService.create(createAccountDto);
  }

  @Get('getAccountsByUser')
  async getAccountsByUserId(@Req() req: any) {
    const accounts = await this.accountService.getAccountsByUserId(req.user.id);
    const { categories, shops, subscriptions, ...user } = await this.userService.getlUserWithRelationsById(req.user.id);
    const bills = await this.billService.getPersonalBillsByUserId(req.user.id); // TODO: workaround for JS Heap out of memory

    const personalAccount = {
      id: null,
      name: 'Personal',
      created: null,
      lastUpdate: null,
      users: [user],
      bills: bills,
      categories: categories,
      shops: shops,
      subscriptions: subscriptions
    }

    return [personalAccount, ...accounts];
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateAccountDto: UpdateAccountDto) {
    return this.accountService.update(id, updateAccountDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.accountService.remove(id);
  }
}
