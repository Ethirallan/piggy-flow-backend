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
import { BillsService } from './bills.service.js';
import { BillPageDto, BillResponseDto } from './dto/bill-response.dto.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { ListBillsQueryDto } from './dto/list-bills-query.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';

const toDate = (iso: string | undefined) =>
  iso === undefined ? undefined : new Date(iso);

@ApiTags('bills')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List the current user's bills, newest first, from all their accounts or one",
  })
  @ApiOkResponse({ type: BillPageDto })
  @ApiBadRequestResponse({
    description:
      'Invalid filters, limit or cursor, a cursor with all, or from not before to',
  })
  @ApiNotFoundResponse({
    description:
      'accountId names an account the current user is not a member of',
  })
  async list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListBillsQueryDto,
  ): Promise<BillPageDto> {
    const page = await this.bills.list(auth.userId, {
      accountId: query.accountId,
      from: toDate(query.from),
      to: toDate(query.to),
      limit: query.limit,
      cursor: query.cursor,
      all: query.all,
    });
    return {
      items: page.items.map((bill) => BillResponseDto.from(bill)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a bill' })
  @ApiOkResponse({ type: BillResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such bill, or the current user is not a member of its account',
  })
  async get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillResponseDto> {
    return BillResponseDto.from(
      await this.bills.findForMember(id, auth.userId),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bill' })
  @ApiCreatedResponse({ type: BillResponseDto })
  @ApiBadRequestResponse({
    description:
      'The body failed validation, or the shop or category is not in this account',
  })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  async create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateBillDto,
  ): Promise<BillResponseDto> {
    return BillResponseDto.from(
      await this.bills.create(auth.userId, {
        accountId: dto.accountId,
        date: new Date(dto.date),
        priceCents: dto.priceCents,
        shopId: dto.shopId,
        categoryId: dto.categoryId,
        comment: dto.comment,
      }),
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a bill, including moving it to another account',
  })
  @ApiOkResponse({ type: BillResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a UUID, the body failed validation or changes nothing, or the shop or category is not in the account',
  })
  @ApiNotFoundResponse({
    description:
      'No such bill, the current user is not a member of its account, or of the account it moves to',
  })
  async update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillDto,
  ): Promise<BillResponseDto> {
    return BillResponseDto.from(
      await this.bills.update(auth.userId, id, {
        accountId: dto.accountId,
        date: toDate(dto.date),
        priceCents: dto.priceCents,
        shopId: dto.shopId,
        categoryId: dto.categoryId,
        comment: dto.comment,
      }),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a bill' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such bill, or the current user is not a member of its account',
  })
  delete(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bills.delete(auth.userId, id);
  }
}
