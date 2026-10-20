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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto.js';
import { SubscriptionResponseDto } from './dto/subscription-response.dto.js';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';

@ApiTags('subscriptions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List the current user's subscriptions by next charge date, from all their accounts or one",
  })
  @ApiOkResponse({ type: SubscriptionResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'accountId is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'accountId names an account the current user is not a member of',
  })
  async list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListSubscriptionsQueryDto,
  ): Promise<SubscriptionResponseDto[]> {
    const found = await this.subscriptions.list(auth.userId, query.accountId);
    return found.map((subscription) =>
      SubscriptionResponseDto.from(subscription),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a subscription' })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such subscription, or the current user is not a member of its account',
  })
  async get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionResponseDto> {
    return SubscriptionResponseDto.from(
      await this.subscriptions.findForMember(id, auth.userId),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a subscription' })
  @ApiCreatedResponse({ type: SubscriptionResponseDto })
  @ApiBadRequestResponse({
    description:
      'The body failed validation, or the shop or category is not in this account',
  })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return SubscriptionResponseDto.from(
      await this.subscriptions.create(auth.userId, {
        accountId: dto.accountId,
        priceCents: dto.priceCents,
        chargeDay: dto.chargeDay,
        name: dto.name,
        shopId: dto.shopId,
        categoryId: dto.categoryId,
      }),
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a subscription, including moving it to another account',
  })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a UUID, the body failed validation or changes nothing, or the shop or category is not in the account',
  })
  @ApiNotFoundResponse({
    description:
      'No such subscription, the current user is not a member of its account, or of the account it moves to',
  })
  async update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return SubscriptionResponseDto.from(
      await this.subscriptions.update(auth.userId, id, {
        accountId: dto.accountId,
        priceCents: dto.priceCents,
        chargeDay: dto.chargeDay,
        name: dto.name,
        shopId: dto.shopId,
        categoryId: dto.categoryId,
      }),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a subscription (the bills it generated stay)',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such subscription, or the current user is not a member of its account',
  })
  delete(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.subscriptions.delete(auth.userId, id);
  }
}
