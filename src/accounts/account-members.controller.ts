import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { LoggingThrottlerGuard } from '../auth/logging-throttler.guard.js';
import { ACCOUNT_RATE_LIMITS } from '../auth/rate-limits.js';
import { AccountMembersService } from './account-members.service.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { MemberResponseDto } from './dto/member-response.dto.js';

@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('accounts/:id/members')
export class AccountMembersController {
  constructor(private readonly members: AccountMembersService) {}

  @Post()
  @UseGuards(LoggingThrottlerGuard)
  @Throttle(ACCOUNT_RATE_LIMITS.addMember)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a registered user to the account by email' })
  @ApiCreatedResponse({ type: MemberResponseDto })
  @ApiBadRequestResponse({
    description: 'The id is not a UUID, or the body failed validation',
  })
  @ApiNotFoundResponse({
    description:
      'No such account, the current user is not a member, or no user has that email',
  })
  @ApiConflictResponse({
    description: 'The account is Personal, or the user is already a member',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many attempts from this IP; try again in a minute',
  })
  async add(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ): Promise<MemberResponseDto> {
    const { member, user } = await this.members.add(id, auth.userId, dto.email);
    return MemberResponseDto.from(member, user);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a member, or leave the account when userId is the current user',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ description: 'An id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'No such account, the current user is not a member, or the user is not a member',
  })
  @ApiConflictResponse({
    description: 'The account is Personal, or this is its last member',
  })
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.members.remove(id, auth.userId, userId);
  }
}
