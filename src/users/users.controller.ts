import {
  Body,
  Controller,
  Get,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current user' })
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser() auth: AuthContext): Promise<UserResponseDto> {
    const user = await this.users.findById(auth.userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    return UserResponseDto.from(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the current user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'The body failed validation' })
  async updateMe(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResponseDto> {
    const user = await this.users.updateDisplayName(
      auth.userId,
      dto.displayName,
    );
    if (!user) {
      throw new UnauthorizedException();
    }
    return UserResponseDto.from(user);
  }
}
