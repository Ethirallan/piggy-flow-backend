import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './health-response.dto.js';

@ApiTags('health')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'Check that the API is running' })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    return { status: 'ok' };
  }
}
