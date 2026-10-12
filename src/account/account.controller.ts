import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, NotFoundException } from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  create(@Req() req: any, @Body() createAccountDto: CreateAccountDto) {
    if (!req.user) throw new NotFoundException();

    // Membership management is a later project: the caller is the only member.
    createAccountDto.users = [req.user];
    return this.accountService.create(createAccountDto);
  }

  @Get('getAccountsByUser')
  getAccountsByUserId(@Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.accountService.getAccountsByUserId(req.user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() updateAccountDto: UpdateAccountDto) {
    if (!req.user) throw new NotFoundException();
    return this.accountService.updateMember(id, req.user.id, updateAccountDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.accountService.removeMember(id, req.user.id);
  }
}
