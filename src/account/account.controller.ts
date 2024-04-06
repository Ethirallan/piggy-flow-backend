import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, Inject } from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Controller('account')
export class AccountController {
  constructor(
    @Inject('ACCOUNT_SERVICE') private readonly accountService: AccountService,
  ) { }

  @Post()
  create(@Req() req: any, @Body() createAccountDto: CreateAccountDto) {
    createAccountDto.users = [...createAccountDto.users ?? [], req.user];
    return this.accountService.create(createAccountDto);
  }

  @Get('getAccountsByUser')
  async getAccountsByUserId(@Req() req: any) {
    const accounts = await this.accountService.getAccountsByUserId(req.user.id);
    const personalAccount = await this.accountService.getPersonalAccount(req.user.id);
    return [personalAccount, ...accounts];
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateAccountDto: UpdateAccountDto) {
    return this.accountService.update(id, updateAccountDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.accountService.remove(id);
  }
}
