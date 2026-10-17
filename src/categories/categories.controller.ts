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
import { CategoriesService } from './categories.service.js';
import { CategoryResponseDto } from './dto/category-response.dto.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@ApiTags('categories')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('accounts/:accountId/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: "List an account's categories" })
  @ApiOkResponse({
    type: CategoryResponseDto,
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
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.categories.list(accountId, auth.userId);
    return categories.map((category) => CategoryResponseDto.from(category));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category in an account' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({
    description: 'The account id is not a UUID, or the body failed validation',
  })
  @ApiNotFoundResponse({
    description: 'No such account, or the current user is not a member',
  })
  @ApiConflictResponse({
    description: 'The account already has a category with that name',
  })
  async create(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.from(
      await this.categories.create(accountId, auth.userId, {
        name: dto.name,
        emoji: dto.emoji,
      }),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a category' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id is not a UUID, the body failed validation, or it changes nothing',
  })
  @ApiNotFoundResponse({
    description:
      'No such account, the current user is not a member, or the category is not in this account',
  })
  @ApiConflictResponse({
    description: 'The account already has a category with that name',
  })
  async update(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.from(
      await this.categories.update(accountId, auth.userId, id, {
        name: dto.name,
        emoji: dto.emoji,
      }),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'An id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such account, the current user is not a member, or the category is not in this account',
  })
  delete(
    @CurrentUser() auth: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.categories.delete(accountId, auth.userId, id);
  }
}
