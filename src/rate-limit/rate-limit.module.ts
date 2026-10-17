import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

/**
 * Per-IP rate limiting. Import it in every module whose controllers use
 * @UseGuards(LoggingThrottlerGuard) with @Throttle(...); it's created once,
 * so all routes share one counter store.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 10, ttl: 60_000 }],
      skipIf: () => process.env.RATE_LIMIT_DISABLED === 'true',
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
