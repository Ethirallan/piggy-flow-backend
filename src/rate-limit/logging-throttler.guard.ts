import { Injectable, Logger, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';

/** ThrottlerGuard that logs every request it turns away. */
@Injectable()
export class LoggingThrottlerGuard extends ThrottlerGuard {
  private readonly rateLimitLogger = new Logger('RateLimit');

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>();
    this.rateLimitLogger.warn({
      event: 'rate_limited',
      ip: request.ip,
      path: request.path,
    });
    await super.throwThrottlingException(context, detail);
  }
}
