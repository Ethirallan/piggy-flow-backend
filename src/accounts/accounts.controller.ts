import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AccountsService } from './accounts.service.js';
import { AccountDetailsDto } from './dto/account-details.dto.js';
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

  @Get(':id')
  @ApiOperation({ summary: 'Get an account and its members' })
  @ApiOkResponse({ type: AccountDetailsDto })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  async details(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountDetailsDto> {
    const { account, members } = await this.accounts.details(id, auth.userId);
    return AccountDetailsDto.withMembers(account, members);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename an account' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiBadRequestResponse({
    description: 'The id is not a UUID, or the body failed validation',
  })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  async rename(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountNameDto,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(
      await this.accounts.rename(id, auth.userId, dto.name),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an account' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  @ApiConflictResponse({
    description: 'The account is Personal, or it still holds data',
  })
  delete(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.accounts.delete(id, auth.userId);
  }
}
