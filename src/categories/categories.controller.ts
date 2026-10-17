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
import { CategoriesService } from './categories.service.js';
import { CategoryResponseDto } from './dto/category-response.dto.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';

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
}
