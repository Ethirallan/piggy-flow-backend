import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Settings shared by main.ts and the e2e tests, so tests run the same app. */
export function configureApp(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // Behind a reverse proxy every request comes from the proxy's IP, so rate
  // limits and logs need Express to read the client IP from X-Forwarded-For.
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

/** Express's `trust proxy` setting: a hop count, true/false, or addresses such as "loopback". */
export function parseTrustProxy(
  value: string | undefined,
): boolean | number | string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  return /^\d+$/.test(value) ? Number(value) : value;
}
