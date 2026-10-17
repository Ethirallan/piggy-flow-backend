import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AccountsService } from './accounts.service.js';
import { AccountNameDto } from './dto/account-name.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';

@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's accounts" })
  @ApiOkResponse({
    type: AccountResponseDto,
    isArray: true,
    description: 'Personal first, then by name',
  })
  async list(@CurrentUser() auth: AuthContext): Promise<AccountResponseDto[]> {
    const accounts = await this.accounts.listForUser(auth.userId);
    return accounts.map((account) => AccountResponseDto.from(account));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a shared account with the current user as its only member',
  })
  @ApiCreatedResponse({ type: AccountResponseDto })
  @ApiBadRequestResponse({ description: 'The body failed validation' })
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: AccountNameDto,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(
      await this.accounts.create(auth.userId, dto.name),
    );
  }
}
