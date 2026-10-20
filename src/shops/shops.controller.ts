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
import { ShopNameDto } from './dto/shop-name.dto.js';
import { ShopResponseDto } from './dto/shop-response.dto.js';
import { ShopsService } from './shops.service.js';

@ApiTags('shops')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('accounts/:accountId/shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get()
  @ApiOperation({ summary: "List an account's shops" })
  @ApiOkResponse({
    type: ShopResponseDto,
    isArray: true,
    description: 'By name ignoring case, then oldest first',
  })
  @ApiBadRequestResponse({ description: 'The account id is not a UUID' })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  async list(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<ShopResponseDto[]> {
    const shops = await this.shops.list(accountId, auth.userId);
    return shops.map((shop) => ShopResponseDto.from(shop));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a shop in an account' })
  @ApiCreatedResponse({ type: ShopResponseDto })
  @ApiBadRequestResponse({
    description: 'The account id is not a UUID, or the body failed validation',
  })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  @ApiConflictResponse({
    description: 'The account already has a shop with that name',
  })
  async create(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: ShopNameDto,
  ): Promise<ShopResponseDto> {
    return ShopResponseDto.from(
      await this.shops.create(accountId, auth.userId, dto.name),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a shop' })
  @ApiOkResponse({ type: ShopResponseDto })
  @ApiBadRequestResponse({
    description: 'An id is not a UUID, or the body failed validation',
  })
  @ApiNotFoundResponse({
    description:
      'No such account, the current user is not a member, or the shop is not in this account',
  })
  @ApiConflictResponse({
    description: 'The account already has a shop with that name',
  })
  async rename(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShopNameDto,
  ): Promise<ShopResponseDto> {
    return ShopResponseDto.from(
      await this.shops.rename(accountId, auth.userId, id, dto.name),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a shop' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'An id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such account, the current user is not a member, or the shop is not in this account',
  })
  @ApiConflictResponse({
    description: 'Bills or subscriptions of the account still use this shop',
  })
  delete(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.shops.delete(accountId, auth.userId, id);
  }
}
