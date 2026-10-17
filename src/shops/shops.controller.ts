import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
}
